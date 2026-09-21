-- Phase 21 — Contract Recovery workflow: fee assessment + client-facing report.
-- Closes the loop the Phase 15 underpayment engine and dedupe_key column were
-- built for but never got wired up to: claim -> processed claim (remittance) ->
-- review -> readjudication (detectUnderpayment) -> fee assessed or none ->
-- report to client -> client response.

ALTER TABLE public.underpayment_disputes
  ADD COLUMN IF NOT EXISTS fee_percent_bps integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assessed_fee_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_response text
    CHECK (client_response IS NULL OR client_response IN ('pending', 'approved_pursue', 'declined', 'handling_internally')),
  ADD COLUMN IF NOT EXISTS client_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_response_notes text,
  ADD COLUMN IF NOT EXISTS report_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS report_sent_at timestamptz;

-- Org-level default contingency fee (basis points, e.g. 2500 = 25%) applied
-- when a dispute's status moves to 'recovered'. Defaults to 0 (unconfigured)
-- rather than an invented percentage — an admin must set a real value.
-- RLS: existing "orgs_update_admin" policy on public.organizations already
-- restricts UPDATE to admin/owner roles; no new policy needed for this column.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS recovery_fee_percent_bps integer NOT NULL DEFAULT 0;
