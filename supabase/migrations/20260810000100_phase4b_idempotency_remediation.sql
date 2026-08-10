-- =============================================================
-- Phase 4B Remediation A — Persistent Idempotency
-- =============================================================
-- Extends idempotency_keys with operation + result_id so callers
-- can replay the original result on a duplicate request.
--
-- Adds four SECURITY DEFINER RPCs:
--   rpc_advance_payment_state   — atomic payment transition + key
--   rpc_log_recovery_event      — atomic recovery insert + accumulation + key
--   rpc_log_write_off           — atomic write-off insert + key
--   rpc_advance_appeal_case     — optimistic-lock state advance + key
--
-- All RPCs:
--   • explicit search_path = public
--   • validate org membership via is_org_member()
--   • enforce tenant boundary (org_id from DB, never trusted from client)
--   • use the PRIMARY KEY on idempotency_keys.key to prevent concurrent
--     duplicate mutations (INSERT fails with unique_violation → duplicate
--     returns the stored result_id)
-- =============================================================

SET search_path = public;

-- ─────────────────────────────────────────────────────────────
-- 1. Extend idempotency_keys
-- ─────────────────────────────────────────────────────────────
-- operation: which mutation this key protects
-- result_id: the event_id / outcome_id produced by the first execution
-- payload_hash: optional SHA-256 hex of canonical request payload;
--               reuse of a key with a different hash → error
ALTER TABLE public.idempotency_keys
  ADD COLUMN IF NOT EXISTS operation   TEXT,
  ADD COLUMN IF NOT EXISTS result_id   TEXT,
  ADD COLUMN IF NOT EXISTS payload_hash TEXT;

COMMENT ON COLUMN public.idempotency_keys.operation    IS 'Logical operation this key protects (payment_advance, recovery_event, write_off, appeal_advance)';
COMMENT ON COLUMN public.idempotency_keys.result_id    IS 'Primary key / event_id produced by the first execution (returned on replay)';
COMMENT ON COLUMN public.idempotency_keys.payload_hash IS 'SHA-256 hex of the canonical request payload; used to reject key reuse with a different payload';

-- ─────────────────────────────────────────────────────────────
-- 2. RPC: rpc_advance_payment_state
-- ─────────────────────────────────────────────────────────────
-- Atomically:
--   a. validates caller is org member
--   b. checks idempotency_keys for p_idempotency_key
--   c. if found → returns stored result without re-mutating
--   d. verifies claim belongs to org and current status matches
--   e. updates claims.status
--   f. inserts idempotency_keys (PRIMARY KEY unique_violation = safe concurrent guard)
--   g. commits all in one transaction
--
-- Returns JSON: { "already_consumed": bool, "result_id": text, "new_status": text }
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_advance_payment_state(
  p_idempotency_key TEXT,
  p_claim_id        TEXT,
  p_org_id          UUID,
  p_from_status     TEXT,
  p_to_status       TEXT,
  p_actor           TEXT,
  p_payload_hash    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing      RECORD;
  v_claim_org_id  UUID;
  v_current_status TEXT;
  v_result_id     TEXT;
BEGIN
  -- 1. Caller must be an authenticated org member
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authentication required';
  END IF;
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: caller is not a member of org %', p_org_id;
  END IF;

  -- 2. Idempotency check (within the same transaction)
  SELECT key, result_id, payload_hash
    INTO v_existing
    FROM public.idempotency_keys
   WHERE key = p_idempotency_key
     AND org_id = p_org_id
   FOR UPDATE;  -- lock the row; concurrent request will wait, then see already_consumed

  IF FOUND THEN
    -- Key already consumed — validate payload consistency
    IF v_existing.payload_hash IS NOT NULL
       AND p_payload_hash IS NOT NULL
       AND v_existing.payload_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different payload', p_idempotency_key;
    END IF;
    RETURN jsonb_build_object(
      'already_consumed', true,
      'result_id', v_existing.result_id,
      'new_status', p_to_status
    );
  END IF;

  -- 3. Validate claim ownership and current status
  SELECT org_id, status
    INTO v_claim_org_id, v_current_status
    FROM public.claims
   WHERE claim_id = p_claim_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: claim % does not exist', p_claim_id;
  END IF;
  IF v_claim_org_id IS DISTINCT FROM p_org_id THEN
    RAISE EXCEPTION 'FORBIDDEN: claim % does not belong to org %', p_claim_id, p_org_id;
  END IF;
  IF v_current_status <> p_from_status THEN
    RAISE EXCEPTION 'STATE_CONFLICT: claim % is in status % not %', p_claim_id, v_current_status, p_from_status;
  END IF;

  -- 4. Apply mutation
  UPDATE public.claims
     SET status = p_to_status,
         updated_at = now()
   WHERE claim_id = p_claim_id;

  -- 5. Generate result_id
  v_result_id := 'PAY-' || p_claim_id || '-' || replace(gen_random_uuid()::text, '-', '');

  -- 6. Record idempotency key (PRIMARY KEY prevents concurrent duplicate)
  INSERT INTO public.idempotency_keys (key, claim_id, org_id, actor, consumed_at, operation, result_id, payload_hash)
  VALUES (p_idempotency_key, p_claim_id, p_org_id, p_actor, now(), 'payment_advance', v_result_id, p_payload_hash);

  RETURN jsonb_build_object(
    'already_consumed', false,
    'result_id', v_result_id,
    'new_status', p_to_status
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_advance_payment_state IS
  'Phase 4B: Atomically advances claim payment status and records idempotency key. Safe for concurrent/retry callers.';

REVOKE ALL ON FUNCTION public.rpc_advance_payment_state FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_advance_payment_state TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. RPC: rpc_log_recovery_event
-- ─────────────────────────────────────────────────────────────
-- Atomically:
--   a. validates org membership
--   b. checks idempotency_keys
--   c. if found → returns stored event_id
--   d. inserts into ops_events
--   e. accumulates recovery_outcomes with atomic SQL expression
--   f. records idempotency key
--
-- Returns JSON: { "already_consumed": bool, "event_id": text }
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_log_recovery_event(
  p_idempotency_key TEXT,
  p_claim_id        TEXT,
  p_org_id          UUID,
  p_actor           TEXT,
  p_recovery_type   TEXT,   -- 'payer_payment' | 'patient_payment' | 'writeoff' | 'adjustment'
  p_amount_cents    BIGINT,
  p_recovered_from  TEXT,
  p_notes           TEXT DEFAULT NULL,
  p_payload_hash    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing      RECORD;
  v_event_id      TEXT;
  v_outcome_id    TEXT;
  v_claim_org_id  UUID;
  v_denied_cents  BIGINT;
  v_resolution    TEXT;
  v_claim_payload JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authentication required';
  END IF;
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: caller is not a member of org %', p_org_id;
  END IF;

  -- Idempotency check
  SELECT key, result_id, payload_hash
    INTO v_existing
    FROM public.idempotency_keys
   WHERE key = p_idempotency_key
     AND org_id = p_org_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.payload_hash IS NOT NULL
       AND p_payload_hash IS NOT NULL
       AND v_existing.payload_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different payload', p_idempotency_key;
    END IF;
    RETURN jsonb_build_object('already_consumed', true, 'event_id', v_existing.result_id);
  END IF;

  -- Validate claim ownership
  SELECT org_id, payload, total_billed_cents
    INTO v_claim_org_id, v_claim_payload, v_denied_cents
    FROM public.claims
   WHERE claim_id = p_claim_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: claim % does not exist', p_claim_id;
  END IF;
  IF v_claim_org_id IS DISTINCT FROM p_org_id THEN
    RAISE EXCEPTION 'FORBIDDEN: claim % does not belong to org %', p_claim_id, p_org_id;
  END IF;

  -- Generate event_id
  v_event_id := 'EV-' || replace(gen_random_uuid()::text, '-', '');

  -- Insert ops_events
  INSERT INTO public.ops_events (
    event_id, kind, claim_id, org_id, actor, summary, payload, occurred_at, created_at
  ) VALUES (
    v_event_id,
    'recovery_recorded',
    p_claim_id,
    p_org_id,
    p_actor,
    'Recovery recorded: ' || p_recovery_type || ' of $' ||
      to_char(p_amount_cents::numeric / 100, 'FM999999990.00') ||
      ' from ' || p_recovered_from,
    jsonb_build_object(
      'recovery_type',    p_recovery_type,
      'amount_cents',     p_amount_cents,
      'recovered_from',   p_recovered_from,
      'notes',            p_notes,
      'idempotency_key',  p_idempotency_key
    ),
    now(),
    now()
  );

  -- Accumulate recovery_outcomes atomically
  v_outcome_id := 'OUT-' || p_claim_id || '-' || p_recovery_type;
  v_resolution := CASE p_recovery_type
    WHEN 'writeoff'         THEN 'written_off'
    WHEN 'patient_payment'  THEN 'patient_responsibility'
    ELSE CASE WHEN p_amount_cents >= COALESCE(v_denied_cents, p_amount_cents)
              THEN 'recovered_full' ELSE 'recovered_partial' END
  END;

  INSERT INTO public.recovery_outcomes (
    outcome_id, claim_id, org_id, resolution_type, resolution_date,
    denied_amount_cents, recovered_amount_cents, unrecovered_amount_cents,
    notes, payload, updated_at
  ) VALUES (
    v_outcome_id, p_claim_id, p_org_id, v_resolution, now(),
    COALESCE(v_denied_cents, p_amount_cents),
    p_amount_cents,
    GREATEST(0, COALESCE(v_denied_cents, p_amount_cents) - p_amount_cents),
    p_recovered_from,
    jsonb_build_object('source', 'rpc_log_recovery_event'),
    now()
  )
  ON CONFLICT (outcome_id) DO UPDATE
    SET recovered_amount_cents   = public.recovery_outcomes.recovered_amount_cents + EXCLUDED.recovered_amount_cents,
        unrecovered_amount_cents = GREATEST(0, public.recovery_outcomes.denied_amount_cents
                                              - (public.recovery_outcomes.recovered_amount_cents + EXCLUDED.recovered_amount_cents)),
        resolution_date          = now(),
        resolution_type          = EXCLUDED.resolution_type,
        updated_at               = now();

  -- Record idempotency key
  INSERT INTO public.idempotency_keys (key, claim_id, org_id, actor, consumed_at, operation, result_id, payload_hash)
  VALUES (p_idempotency_key, p_claim_id, p_org_id, p_actor, now(), 'recovery_event', v_event_id, p_payload_hash);

  RETURN jsonb_build_object('already_consumed', false, 'event_id', v_event_id);
END;
$$;

COMMENT ON FUNCTION public.rpc_log_recovery_event IS
  'Phase 4B: Atomically inserts recovery ops_event, accumulates recovery_outcomes, and records idempotency key.';

REVOKE ALL ON FUNCTION public.rpc_log_recovery_event FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_log_recovery_event TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. RPC: rpc_log_write_off
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_log_write_off(
  p_idempotency_key TEXT,
  p_claim_id        TEXT,
  p_org_id          UUID,
  p_actor           TEXT,
  p_reason          TEXT,
  p_payload_hash    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing     RECORD;
  v_event_id     TEXT;
  v_claim_org_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authentication required';
  END IF;
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: caller is not a member of org %', p_org_id;
  END IF;

  SELECT key, result_id, payload_hash
    INTO v_existing
    FROM public.idempotency_keys
   WHERE key = p_idempotency_key
     AND org_id = p_org_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.payload_hash IS NOT NULL
       AND p_payload_hash IS NOT NULL
       AND v_existing.payload_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different payload', p_idempotency_key;
    END IF;
    RETURN jsonb_build_object('already_consumed', true, 'event_id', v_existing.result_id);
  END IF;

  SELECT org_id INTO v_claim_org_id FROM public.claims WHERE claim_id = p_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: claim % does not exist', p_claim_id;
  END IF;
  IF v_claim_org_id IS DISTINCT FROM p_org_id THEN
    RAISE EXCEPTION 'FORBIDDEN: claim % does not belong to org %', p_claim_id, p_org_id;
  END IF;

  v_event_id := 'EV-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.ops_events (
    event_id, kind, claim_id, org_id, actor, summary, payload, occurred_at, created_at
  ) VALUES (
    v_event_id, 'claim_written_off', p_claim_id, p_org_id, p_actor,
    'Claim written off: ' || p_reason,
    jsonb_build_object('reason', p_reason, 'idempotency_key', p_idempotency_key),
    now(), now()
  );

  INSERT INTO public.idempotency_keys (key, claim_id, org_id, actor, consumed_at, operation, result_id, payload_hash)
  VALUES (p_idempotency_key, p_claim_id, p_org_id, p_actor, now(), 'write_off', v_event_id, p_payload_hash);

  RETURN jsonb_build_object('already_consumed', false, 'event_id', v_event_id);
END;
$$;

COMMENT ON FUNCTION public.rpc_log_write_off IS
  'Phase 4B: Atomically inserts write-off ops_event and records idempotency key.';

REVOKE ALL ON FUNCTION public.rpc_log_write_off FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_log_write_off TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. RPC: rpc_advance_appeal_case
-- ─────────────────────────────────────────────────────────────
-- Optimistic concurrency: UPDATE ... WHERE current_state = expected_state
-- Returns { "already_consumed": bool, "result_id": text, "new_state": text }
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_advance_appeal_case(
  p_idempotency_key   TEXT,
  p_case_id           UUID,
  p_org_id            UUID,
  p_actor             TEXT,
  p_expected_state    TEXT,
  p_next_state        TEXT,
  p_extra_patch       JSONB DEFAULT NULL,
  p_payload_hash      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing      RECORD;
  v_result_id     TEXT;
  v_rows_updated  INT;
  v_case_org_id   UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authentication required';
  END IF;
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: caller is not a member of org %', p_org_id;
  END IF;

  SELECT key, result_id, payload_hash
    INTO v_existing
    FROM public.idempotency_keys
   WHERE key = p_idempotency_key
     AND org_id = p_org_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.payload_hash IS NOT NULL
       AND p_payload_hash IS NOT NULL
       AND v_existing.payload_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different payload', p_idempotency_key;
    END IF;
    RETURN jsonb_build_object('already_consumed', true, 'result_id', v_existing.result_id, 'new_state', p_next_state);
  END IF;

  -- Validate case ownership
  SELECT organization_id INTO v_case_org_id
    FROM public.appeal_recovery_cases
   WHERE id = p_case_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: appeal_recovery_case % does not exist', p_case_id;
  END IF;
  IF v_case_org_id IS DISTINCT FROM p_org_id THEN
    RAISE EXCEPTION 'FORBIDDEN: case % does not belong to org %', p_case_id, p_org_id;
  END IF;

  -- Optimistic-lock update: only succeeds if current_state = expected
  UPDATE public.appeal_recovery_cases
     SET current_state = p_next_state,
         updated_at    = now()
   WHERE id = p_case_id
     AND current_state = p_expected_state;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION 'STATE_CONFLICT: case % is no longer in state %', p_case_id, p_expected_state;
  END IF;

  v_result_id := 'ARC-' || p_case_id || '-' || p_next_state;

  INSERT INTO public.idempotency_keys (key, claim_id, org_id, actor, consumed_at, operation, result_id, payload_hash)
  VALUES (p_idempotency_key,
          (SELECT claim_id FROM public.appeal_recovery_cases WHERE id = p_case_id),
          p_org_id, p_actor, now(), 'appeal_advance', v_result_id, p_payload_hash);

  RETURN jsonb_build_object('already_consumed', false, 'result_id', v_result_id, 'new_state', p_next_state);
END;
$$;

COMMENT ON FUNCTION public.rpc_advance_appeal_case IS
  'Phase 4B: Optimistic-lock appeal case state advance with atomic idempotency key recording.';

REVOKE ALL ON FUNCTION public.rpc_advance_appeal_case FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_advance_appeal_case TO authenticated;
