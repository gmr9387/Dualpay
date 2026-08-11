-- =============================================================
-- Phase 4B Remediation C — Idempotency Key Namespace Comment
-- =============================================================
-- Documents the enforced application-level key namespacing convention.
-- No schema changes. No data changes.
--
-- All new idempotency keys submitted to Phase 4B RPCs MUST be prefixed
-- with the operation name followed by a colon:
--
--   payment:<uuid>   → rpc_advance_payment_state
--   recovery:<uuid>  → rpc_log_recovery_event
--   write_off:<uuid> → rpc_log_write_off
--   appeal:<uuid>    → rpc_advance_appeal_case
--
-- This prevents accidental cross-operation key reuse.  The DB already
-- rejects such reuse at the RPC level via the operation consistency check
-- (IDEMPOTENCY_CONFLICT: key was used for a different operation).  The
-- application-level prefix makes violations immediately visible in logs.
--
-- The authoritative idempotency gate remains the Phase 4B SECURITY DEFINER
-- RPCs.  The prefix is a defensive naming convention, not a DB constraint.
-- =============================================================

COMMENT ON TABLE public.idempotency_keys IS
  'Idempotency key registry for Phase 4B critical financial mutations. '
  'All keys must be namespaced: payment:<uuid>, recovery:<uuid>, '
  'write_off:<uuid>, or appeal:<uuid>. '
  'Authoritative writes go through rpc_advance_payment_state, '
  'rpc_log_recovery_event, rpc_log_write_off, rpc_advance_appeal_case only.';
