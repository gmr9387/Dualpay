-- =============================================================
-- Phase 5A — Appeal Atomicity Remediation
-- =============================================================
-- Closes the Phase 5A blocker identified during appeal-lifecycle
-- tracing:
--
--   BEFORE: Two separate appeal paths existed:
--     1. logAppealEvent() → direct INSERT ops_events (no idempotency)
--     2. rpc_advance_appeal_case() → state advance, NO ops_events
--
--   AFTER: One authoritative path performs, in a single transaction:
--     1. idempotency key reservation (first-use / replay)
--     2. tenant + auth validation
--     3. appeal_recovery_cases state advance (when p_case_id IS NOT NULL)
--     4. p_extra_patch column update (when provided)
--     5. INSERT exactly one ops_events audit row
--     6. commit result_id onto idempotency_keys
--
-- New parameters (all DEFAULT NULL for backward compatibility):
--   p_event_kind     TEXT  — ops_events.kind value (required for audit path)
--   p_event_summary  TEXT  — ops_events.summary value
--   p_event_payload  JSONB — ops_events.payload (appeal_status, payer_response, notes, …)
--   p_claim_id       TEXT  — ops_events.claim_id; also used in idempotency scoping
--
-- p_case_id is now nullable.  When NULL only the idempotency + audit
-- event path executes (former logAppealEvent use case).
--
-- p_extra_patch is now applied inside the transaction rather than via
-- a separate client-side UPDATE.  Supported keys:
--   recovered_amount_cents  BIGINT
--   payer_response_status   TEXT
--   packet_id               TEXT
--
-- result_id semantics (unchanged for case-transition path):
--   case transition:  'ARC-<case_id>-<next_state>'
--   event-only path:  'EV-<event_id>'
--
-- Idempotency behaviour (unchanged from Remediation B):
--   first use       → reserve key, execute mutation, commit result_id
--   same-key replay → return stored result_id (no second mutation)
--   payload conflict→ RAISE EXCEPTION IDEMPOTENCY_CONFLICT
--   cross-op reuse  → RAISE EXCEPTION IDEMPOTENCY_CONFLICT
--   cross-tenant    → RAISE EXCEPTION FORBIDDEN
--   rollback/retry  → reservation rolls back with the transaction; retry succeeds
--
-- No schema changes to existing tables.
-- No historical migrations modified.
-- CREATE OR REPLACE preserves existing GRANT EXECUTE TO authenticated.
-- =============================================================

SET search_path = public;

CREATE OR REPLACE FUNCTION public.rpc_advance_appeal_case(
  p_idempotency_key   TEXT,
  p_case_id           UUID    DEFAULT NULL,
  p_org_id            UUID    DEFAULT NULL,
  p_actor             TEXT    DEFAULT 'unknown',
  p_expected_state    TEXT    DEFAULT NULL,
  p_next_state        TEXT    DEFAULT NULL,
  p_extra_patch       JSONB   DEFAULT NULL,
  p_payload_hash      TEXT    DEFAULT NULL,
  -- Phase 5A: audit event parameters
  p_event_kind        TEXT    DEFAULT NULL,
  p_event_summary     TEXT    DEFAULT NULL,
  p_event_payload     JSONB   DEFAULT NULL,
  p_claim_id          TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing               RECORD;
  v_reserved_key           TEXT;
  v_result_id              TEXT;
  v_event_id               TEXT;
  v_rows_updated           INT;
  v_case_org_id            UUID;
  v_claim_id_val           TEXT;
  v_effective_payload_hash TEXT;
BEGIN
  -- ── 1. Auth check ──────────────────────────────────────────────
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authentication required';
  END IF;
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_org_id is required';
  END IF;
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: caller is not a member of org %', p_org_id;
  END IF;

  -- ── 2. Determine effective claim_id for idempotency scoping ────
  -- Prefer p_claim_id (explicit); fall back to claim_id looked up from
  -- the case record (populated in step 4, so we pre-fetch when possible).
  v_claim_id_val := p_claim_id;

  IF v_claim_id_val IS NULL AND p_case_id IS NOT NULL THEN
    SELECT claim_id INTO v_claim_id_val
      FROM public.appeal_recovery_cases
     WHERE id = p_case_id;
    -- NOT FOUND handled in step 4 below after reservation attempt
  END IF;

  -- ── 3. Compute payload hash ────────────────────────────────────
  v_effective_payload_hash := COALESCE(
    p_payload_hash,
    md5(
      jsonb_build_object(
        'operation',      'appeal_advance',
        'case_id',        p_case_id,
        'org_id',         p_org_id,
        'expected_state', p_expected_state,
        'next_state',     p_next_state,
        'extra_patch',    COALESCE(p_extra_patch, '{}'),
        'event_kind',     p_event_kind
      )::text
    )
  );

  -- ── 4. First-use reservation (ON CONFLICT DO NOTHING) ──────────
  INSERT INTO public.idempotency_keys (
    key, claim_id, org_id, actor, consumed_at, operation, result_id, payload_hash
  )
  VALUES (
    p_idempotency_key,
    v_claim_id_val,
    p_org_id,
    p_actor,
    now(),
    'appeal_advance',
    NULL,
    v_effective_payload_hash
  )
  ON CONFLICT (key) DO NOTHING
  RETURNING key INTO v_reserved_key;

  -- ── 5. If reservation not owned by us: replay or conflict ──────
  IF v_reserved_key IS NULL THEN
    SELECT key, claim_id, org_id, operation, result_id, payload_hash
      INTO v_existing
      FROM public.idempotency_keys
     WHERE key = p_idempotency_key
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'IDEMPOTENCY_RETRY: key % could not be loaded after conflict; retry request', p_idempotency_key;
    END IF;
    IF v_existing.org_id IS DISTINCT FROM p_org_id THEN
      RAISE EXCEPTION 'FORBIDDEN: idempotency key % is scoped to another tenant', p_idempotency_key;
    END IF;
    IF v_existing.operation IS DISTINCT FROM 'appeal_advance' THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different operation', p_idempotency_key;
    END IF;
    IF v_claim_id_val IS NOT NULL AND v_existing.claim_id IS DISTINCT FROM v_claim_id_val THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different claim', p_idempotency_key;
    END IF;
    IF v_existing.payload_hash IS DISTINCT FROM v_effective_payload_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different payload', p_idempotency_key;
    END IF;
    IF v_existing.result_id IS NULL THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % exists without a committed result; retry', p_idempotency_key;
    END IF;

    RETURN jsonb_build_object(
      'already_consumed', true,
      'result_id',        v_existing.result_id,
      'new_state',        p_next_state
    );
  END IF;

  -- ── 6. Case-transition path (only when p_case_id IS NOT NULL) ──
  IF p_case_id IS NOT NULL THEN
    -- Re-fetch org + claim linkage (may have been fetched above but
    -- we need org validation here regardless).
    SELECT organization_id, claim_id
      INTO v_case_org_id, v_claim_id_val
      FROM public.appeal_recovery_cases
     WHERE id = p_case_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: appeal_recovery_case % does not exist', p_case_id;
    END IF;
    IF v_case_org_id IS DISTINCT FROM p_org_id THEN
      RAISE EXCEPTION 'FORBIDDEN: case % does not belong to org %', p_case_id, p_org_id;
    END IF;

    -- Optimistic-lock state advance
    UPDATE public.appeal_recovery_cases
       SET current_state = p_next_state,
           updated_at    = now()
     WHERE id             = p_case_id
       AND current_state  = p_expected_state;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated = 0 THEN
      RAISE EXCEPTION 'STATE_CONFLICT: case % is no longer in state %', p_case_id, p_expected_state;
    END IF;

    -- Apply extra_patch columns (explicit assignments — no dynamic SQL)
    IF p_extra_patch IS NOT NULL AND p_extra_patch <> '{}'::jsonb THEN
      UPDATE public.appeal_recovery_cases
         SET recovered_amount_cents = COALESCE(
               (p_extra_patch->>'recovered_amount_cents')::bigint,
               recovered_amount_cents
             ),
             payer_response_status  = COALESCE(
               p_extra_patch->>'payer_response_status',
               payer_response_status
             ),
             packet_id              = COALESCE(
               p_extra_patch->>'packet_id',
               packet_id
             )
       WHERE id = p_case_id;
    END IF;

    v_result_id := 'ARC-' || p_case_id::text || '-' || p_next_state;
  ELSE
    -- Event-only path: result_id derived from event_id (set below)
    v_result_id := NULL;  -- filled after event insert
  END IF;

  -- ── 7. Insert audit event into ops_events ──────────────────────
  -- Only when an event kind was supplied.  This guards legacy callers
  -- that don't yet pass p_event_kind while the app is being rolled out.
  IF p_event_kind IS NOT NULL THEN
    v_event_id := 'EV-' || gen_random_uuid()::text;

    INSERT INTO public.ops_events (
      event_id, occurred_at, kind, claim_id, org_id,
      actor, summary, payload, created_at
    )
    VALUES (
      v_event_id,
      now(),
      p_event_kind,
      v_claim_id_val,
      p_org_id,
      p_actor,
      COALESCE(p_event_summary, p_event_kind),
      COALESCE(p_event_payload, '{}'),
      now()
    );

    -- For the event-only path the result_id IS the event reference
    IF v_result_id IS NULL THEN
      v_result_id := 'EV-' || v_event_id;
    END IF;
  END IF;

  -- Guard: at least one action must have been taken
  IF v_result_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_case_id and p_event_kind cannot both be NULL';
  END IF;

  -- ── 8. Commit result_id onto the reserved idempotency row ──────
  UPDATE public.idempotency_keys
     SET result_id   = v_result_id,
         consumed_at = now(),
         actor       = p_actor
   WHERE key         = p_idempotency_key
     AND org_id      = p_org_id
     AND operation   = 'appeal_advance'
     AND result_id   IS NULL;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated <> 1 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: reservation lost for key %', p_idempotency_key;
  END IF;

  RETURN jsonb_build_object(
    'already_consumed', false,
    'result_id',        v_result_id,
    'new_state',        p_next_state,
    'event_id',         v_event_id
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_advance_appeal_case IS
  'Phase 5A: Single authoritative appeal mutation path. '
  'Atomically reserves idempotency key, advances appeal_recovery_cases state (when p_case_id IS NOT NULL), '
  'applies p_extra_patch columns, inserts one ops_events audit row (when p_event_kind IS NOT NULL), '
  'and commits result_id. Concurrent same-key callers return stored result_id without a second mutation. '
  'Replaces the prior Phase 4B Remediation A/B versions.';

-- GRANT EXECUTE is preserved by CREATE OR REPLACE for existing grants.
-- Explicitly restating for auditor clarity and defence-in-depth.
REVOKE ALL ON FUNCTION public.rpc_advance_appeal_case FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_advance_appeal_case TO authenticated;
