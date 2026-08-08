-- =========================================================
-- PASS 3 — SECURITY DEFINER hardening
-- =========================================================
-- prevent_ops_events_update_delete() was defined without an
-- explicit search_path, leaving it vulnerable to search_path
-- injection.  All other SECURITY DEFINER functions in the
-- codebase already use SET search_path = public.
-- =========================================================

CREATE OR REPLACE FUNCTION public.prevent_ops_events_update_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'ops_events is append-only';
END;
$$;
