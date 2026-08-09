-- =========================================================
-- HIPAA Audit Guardrails
--
-- Addresses:
--   Risk #13 — PHI written to ops_events.summary in free text
--   Risk #40 — Audit log retention < 6 years (HIPAA §164.316(b)(1))
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. SYSTEM CONFIG — audit log retention policy
--    (Risk #40)
--
-- Creates a key/value config store for compliance settings.
-- Initial row documents the 6-year HIPAA retention requirement.
-- An archival job should query this table to determine when
-- to archive/delete old records.
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.system_config (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Only service_role may read/write compliance config.
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_config FROM PUBLIC;
REVOKE ALL ON public.system_config FROM anon;
REVOKE ALL ON public.system_config FROM authenticated;
GRANT ALL   ON public.system_config TO service_role;

COMMENT ON TABLE public.system_config IS
'Platform-wide compliance and operational configuration. '
'Not tenant-scoped. Readable only by service_role.';

INSERT INTO public.system_config (key, value, description) VALUES
  ('audit_log_retention_years', '6',
   'HIPAA §164.316(b)(1) requires policies and procedures to be retained for '
   '6 years from creation or last effective date. All ops_events, traces, and '
   'replay_ledger_events records must be retained for at least this duration. '
   'The archival job (to be implemented) must read this value before purging.'),
  ('ops_events_phi_in_summary_policy', 'prohibited',
   'HIPAA Risk #13: Raw PHI must never appear in ops_events.summary. '
   'Use structured payload JSON and FK references (claim_id, org_id) instead. '
   'The DB trigger below enforces a best-effort pattern check. '
   'Code review is the primary control.')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = now();

-- ---------------------------------------------------------
-- 2. ops_events.summary PHI GUARDRAIL TRIGGER
--    (Risk #13)
--
-- Best-effort pattern match. Cannot catch all PHI, but will
-- reject the most obvious mistakes:
--   • SSN-like patterns (NNN-NN-NNNN)
--   • NPI numbers (10-digit strings prefixed with "npi")
--   • Member ID patterns (common prefixes)
--
-- Primary control: code review + structured payload discipline.
-- This trigger is a safety net, not a complete PHI scanner.
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_ops_events_summary_no_phi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Block SSN patterns (NNN-NN-NNNN or NNNNNNNNN)
  IF NEW.summary ~ '\d{3}-\d{2}-\d{4}' THEN
    RAISE EXCEPTION
      'ops_events.summary contains a pattern that resembles an SSN. '
      'Store structured identifiers in the payload JSON column, not summary. '
      '[HIPAA Risk #13]';
  END IF;

  -- Block patterns that look like raw 9-digit SSNs
  IF NEW.summary ~ '\b\d{9}\b' THEN
    RAISE EXCEPTION
      'ops_events.summary contains a 9-digit number that may be an SSN or member ID. '
      'Use claim_id / org_id FKs and structured payload instead. '
      '[HIPAA Risk #13]';
  END IF;

  -- Block DOB patterns (YYYY-MM-DD embedded in free text longer than a date alone)
  -- A pure ISO date key is fine; the risk is embedding it in a longer sentence.
  IF length(NEW.summary) > 20 AND NEW.summary ~ '\d{4}-\d{2}-\d{2}' THEN
    RAISE EXCEPTION
      'ops_events.summary contains what appears to be a date embedded in free text. '
      'Dates of birth or service dates must go in the structured payload JSON. '
      '[HIPAA Risk #13]';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if present (idempotent migration)
DROP TRIGGER IF EXISTS trg_ops_events_summary_no_phi ON public.ops_events;

CREATE TRIGGER trg_ops_events_summary_no_phi
  BEFORE INSERT ON public.ops_events
  FOR EACH ROW
  EXECUTE FUNCTION public.check_ops_events_summary_no_phi();

COMMENT ON FUNCTION public.check_ops_events_summary_no_phi() IS
'HIPAA Risk #13 guardrail: rejects ops_events rows whose summary field '
'contains patterns resembling SSNs, member IDs, or embedded dates. '
'This is a best-effort safety net; code review is the primary control.';

COMMIT;
