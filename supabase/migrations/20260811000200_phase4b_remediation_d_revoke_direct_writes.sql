-- =============================================================
-- Phase 4B Remediation D — Close Direct Write Bypass
-- =============================================================
-- The original table creation migration granted:
--
--   GRANT SELECT, INSERT ON public.idempotency_keys TO authenticated;
--
-- and created a matching INSERT RLS policy ("idempotency_keys_insert").
-- This allowed authenticated clients to write to idempotency_keys directly,
-- bypassing the four SECURITY DEFINER RPCs that are the only authorized
-- mutation path for Phase 4B financial operations.
--
-- After this migration the intended architecture is enforced at the DB level:
--
--   APPLICATION
--       ↓
--   FOUR AUTHORITATIVE RPCs (SECURITY DEFINER, SET search_path = public)
--       ↓
--   atomic idempotency reservation
--       ↓
--   financial mutation
--       ↓
--   result persistence
--
-- SELECT is preserved — application code reads idempotency_keys via
-- is_org_member()-scoped SELECT queries in the hooks and state machine.
--
-- The RPCs execute under their OWNER's privileges (SECURITY DEFINER), so
-- revoking INSERT from the authenticated role does not affect them.
-- No UPDATE or DELETE grant was ever issued to authenticated; confirmed
-- by reviewing the original migration.
-- =============================================================

SET search_path = public;

-- 1. Revoke direct INSERT from authenticated clients.
--    UPDATE and DELETE were never granted to authenticated — no-op for those,
--    but revoked explicitly for defence-in-depth.
REVOKE INSERT ON public.idempotency_keys FROM authenticated;
REVOKE UPDATE ON public.idempotency_keys FROM authenticated;
REVOKE DELETE ON public.idempotency_keys FROM authenticated;

-- 2. Drop the now-unreachable INSERT policy.
--    After revoking INSERT, the policy can never be reached by authenticated
--    clients.  Dropping it removes dead code and avoids any future confusion.
DROP POLICY IF EXISTS "idempotency_keys_insert" ON public.idempotency_keys;

-- 3. Verify SELECT is retained (no change needed, but this comment confirms intent).
--    GRANT SELECT ON public.idempotency_keys TO authenticated; -- already in effect

-- 4. Confirm SECURITY DEFINER RPC execute grants are unchanged.
--    These are function-level grants and are unaffected by table-level changes.
--    Listing them here for auditor clarity only (no SQL change required):
--
--    GRANT EXECUTE ON FUNCTION public.rpc_advance_payment_state  TO authenticated;
--    GRANT EXECUTE ON FUNCTION public.rpc_log_recovery_event     TO authenticated;
--    GRANT EXECUTE ON FUNCTION public.rpc_log_write_off          TO authenticated;
--    GRANT EXECUTE ON FUNCTION public.rpc_advance_appeal_case    TO authenticated;
