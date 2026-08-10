-- =============================================================
-- Phase 4B Remediation B — Close First-Use Idempotency Race
-- =============================================================
-- Replaces the four Phase 4B RPCs with an atomic first-use reservation pattern:
--   1) INSERT idempotency key reservation with ON CONFLICT DO NOTHING
--   2) if reservation owned by this transaction: execute mutation exactly once
--   3) persist result_id onto reserved row before commit
--   4) if reservation already exists: return stored committed result_id
--
-- Rollback semantics:
--   Reservation is created inside the same transaction as mutation.
--   If mutation errors and transaction rolls back, reservation row rolls back too,
--   so retry can execute normally (no stuck pending state).
-- =============================================================

SET search_path = public;

-- -----------------------------------------------------------------
-- rpc_advance_payment_state
-- -----------------------------------------------------------------
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
  v_existing               RECORD;
  v_reserved_key           TEXT;
  v_claim_org_id           UUID;
  v_current_status         TEXT;
  v_result_id              TEXT;
  v_rows_updated           INT;
  v_effective_payload_hash TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authentication required';
  END IF;
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: caller is not a member of org %', p_org_id;
  END IF;

  v_effective_payload_hash := COALESCE(
    p_payload_hash,
    md5(
      jsonb_build_object(
        'operation', 'payment_advance',
        'claim_id', p_claim_id,
        'org_id', p_org_id,
        'from_status', p_from_status,
        'to_status', p_to_status
      )::text
    )
  );

  INSERT INTO public.idempotency_keys (
    key, claim_id, org_id, actor, consumed_at, operation, result_id, payload_hash
  )
  VALUES (
    p_idempotency_key, p_claim_id, p_org_id, p_actor, now(), 'payment_advance', NULL, v_effective_payload_hash
  )
  ON CONFLICT (key) DO NOTHING
  RETURNING key INTO v_reserved_key;

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
    IF v_existing.operation IS DISTINCT FROM 'payment_advance' THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different operation', p_idempotency_key;
    END IF;
    IF v_existing.claim_id IS DISTINCT FROM p_claim_id THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different claim', p_idempotency_key;
    END IF;
    IF v_existing.payload_hash IS DISTINCT FROM v_effective_payload_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different payload', p_idempotency_key;
    END IF;
    IF v_existing.result_id IS NULL THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % exists without a committed result', p_idempotency_key;
    END IF;

    RETURN jsonb_build_object(
      'already_consumed', true,
      'result_id', v_existing.result_id,
      'new_status', p_to_status
    );
  END IF;

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

  UPDATE public.claims
     SET status = p_to_status,
         updated_at = now()
   WHERE claim_id = p_claim_id;

  v_result_id := 'PAY-' || p_claim_id || '-' || replace(gen_random_uuid()::text, '-', '');

  UPDATE public.idempotency_keys
     SET result_id = v_result_id,
         consumed_at = now(),
         actor = p_actor
   WHERE key = p_idempotency_key
     AND org_id = p_org_id
     AND operation = 'payment_advance'
     AND claim_id = p_claim_id
     AND payload_hash IS NOT DISTINCT FROM v_effective_payload_hash
     AND result_id IS NULL;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated <> 1 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: reservation lost for key %', p_idempotency_key;
  END IF;

  RETURN jsonb_build_object(
    'already_consumed', false,
    'result_id', v_result_id,
    'new_status', p_to_status
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_advance_payment_state IS
  'Phase 4B Remediation B: Atomic first-use idempotency reservation prevents concurrent same-key race; duplicate callers return stored result_id.';

REVOKE ALL ON FUNCTION public.rpc_advance_payment_state FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_advance_payment_state TO authenticated;

-- -----------------------------------------------------------------
-- rpc_log_recovery_event
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_log_recovery_event(
  p_idempotency_key TEXT,
  p_claim_id        TEXT,
  p_org_id          UUID,
  p_actor           TEXT,
  p_recovery_type   TEXT,
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
  v_existing               RECORD;
  v_reserved_key           TEXT;
  v_event_id               TEXT;
  v_outcome_id             TEXT;
  v_claim_org_id           UUID;
  v_denied_cents           BIGINT;
  v_resolution             TEXT;
  v_claim_payload          JSONB;
  v_rows_updated           INT;
  v_effective_payload_hash TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authentication required';
  END IF;
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: caller is not a member of org %', p_org_id;
  END IF;

  v_effective_payload_hash := COALESCE(
    p_payload_hash,
    md5(
      jsonb_build_object(
        'operation', 'recovery_event',
        'claim_id', p_claim_id,
        'org_id', p_org_id,
        'recovery_type', p_recovery_type,
        'amount_cents', p_amount_cents,
        'recovered_from', p_recovered_from,
        'notes', p_notes
      )::text
    )
  );

  INSERT INTO public.idempotency_keys (
    key, claim_id, org_id, actor, consumed_at, operation, result_id, payload_hash
  )
  VALUES (
    p_idempotency_key, p_claim_id, p_org_id, p_actor, now(), 'recovery_event', NULL, v_effective_payload_hash
  )
  ON CONFLICT (key) DO NOTHING
  RETURNING key INTO v_reserved_key;

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
    IF v_existing.operation IS DISTINCT FROM 'recovery_event' THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different operation', p_idempotency_key;
    END IF;
    IF v_existing.claim_id IS DISTINCT FROM p_claim_id THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different claim', p_idempotency_key;
    END IF;
    IF v_existing.payload_hash IS DISTINCT FROM v_effective_payload_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different payload', p_idempotency_key;
    END IF;
    IF v_existing.result_id IS NULL THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % exists without a committed result', p_idempotency_key;
    END IF;

    RETURN jsonb_build_object('already_consumed', true, 'event_id', v_existing.result_id);
  END IF;

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

  v_event_id := 'EV-' || replace(gen_random_uuid()::text, '-', '');

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

  UPDATE public.idempotency_keys
     SET result_id = v_event_id,
         consumed_at = now(),
         actor = p_actor
   WHERE key = p_idempotency_key
     AND org_id = p_org_id
     AND operation = 'recovery_event'
     AND claim_id = p_claim_id
     AND payload_hash IS NOT DISTINCT FROM v_effective_payload_hash
     AND result_id IS NULL;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated <> 1 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: reservation lost for key %', p_idempotency_key;
  END IF;

  RETURN jsonb_build_object('already_consumed', false, 'event_id', v_event_id);
END;
$$;

COMMENT ON FUNCTION public.rpc_log_recovery_event IS
  'Phase 4B Remediation B: Atomic first-use reservation for recovery events; concurrent same-key callers return stored event_id.';

REVOKE ALL ON FUNCTION public.rpc_log_recovery_event FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_log_recovery_event TO authenticated;

-- -----------------------------------------------------------------
-- rpc_log_write_off
-- -----------------------------------------------------------------
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
  v_existing               RECORD;
  v_reserved_key           TEXT;
  v_event_id               TEXT;
  v_claim_org_id           UUID;
  v_rows_updated           INT;
  v_effective_payload_hash TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authentication required';
  END IF;
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: caller is not a member of org %', p_org_id;
  END IF;

  v_effective_payload_hash := COALESCE(
    p_payload_hash,
    md5(
      jsonb_build_object(
        'operation', 'write_off',
        'claim_id', p_claim_id,
        'org_id', p_org_id,
        'reason', p_reason
      )::text
    )
  );

  INSERT INTO public.idempotency_keys (
    key, claim_id, org_id, actor, consumed_at, operation, result_id, payload_hash
  )
  VALUES (
    p_idempotency_key, p_claim_id, p_org_id, p_actor, now(), 'write_off', NULL, v_effective_payload_hash
  )
  ON CONFLICT (key) DO NOTHING
  RETURNING key INTO v_reserved_key;

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
    IF v_existing.operation IS DISTINCT FROM 'write_off' THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different operation', p_idempotency_key;
    END IF;
    IF v_existing.claim_id IS DISTINCT FROM p_claim_id THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different claim', p_idempotency_key;
    END IF;
    IF v_existing.payload_hash IS DISTINCT FROM v_effective_payload_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different payload', p_idempotency_key;
    END IF;
    IF v_existing.result_id IS NULL THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % exists without a committed result', p_idempotency_key;
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

  UPDATE public.idempotency_keys
     SET result_id = v_event_id,
         consumed_at = now(),
         actor = p_actor
   WHERE key = p_idempotency_key
     AND org_id = p_org_id
     AND operation = 'write_off'
     AND claim_id = p_claim_id
     AND payload_hash IS NOT DISTINCT FROM v_effective_payload_hash
     AND result_id IS NULL;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated <> 1 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: reservation lost for key %', p_idempotency_key;
  END IF;

  RETURN jsonb_build_object('already_consumed', false, 'event_id', v_event_id);
END;
$$;

COMMENT ON FUNCTION public.rpc_log_write_off IS
  'Phase 4B Remediation B: Atomic first-use reservation for write-off events; concurrent same-key callers return stored event_id.';

REVOKE ALL ON FUNCTION public.rpc_log_write_off FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_log_write_off TO authenticated;

-- -----------------------------------------------------------------
-- rpc_advance_appeal_case
-- -----------------------------------------------------------------
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
  v_existing               RECORD;
  v_reserved_key           TEXT;
  v_result_id              TEXT;
  v_rows_updated           INT;
  v_case_org_id            UUID;
  v_claim_id_val           TEXT;
  v_effective_payload_hash TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authentication required';
  END IF;
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: caller is not a member of org %', p_org_id;
  END IF;

  SELECT organization_id, claim_id INTO v_case_org_id, v_claim_id_val
    FROM public.appeal_recovery_cases
   WHERE id = p_case_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: appeal_recovery_case % does not exist', p_case_id;
  END IF;
  IF v_case_org_id IS DISTINCT FROM p_org_id THEN
    RAISE EXCEPTION 'FORBIDDEN: case % does not belong to org %', p_case_id, p_org_id;
  END IF;

  v_effective_payload_hash := COALESCE(
    p_payload_hash,
    md5(
      jsonb_build_object(
        'operation', 'appeal_advance',
        'case_id', p_case_id,
        'org_id', p_org_id,
        'expected_state', p_expected_state,
        'next_state', p_next_state,
        'extra_patch', COALESCE(p_extra_patch, '{}'::jsonb)
      )::text
    )
  );

  INSERT INTO public.idempotency_keys (
    key, claim_id, org_id, actor, consumed_at, operation, result_id, payload_hash
  )
  VALUES (
    p_idempotency_key, v_claim_id_val, p_org_id, p_actor, now(), 'appeal_advance', NULL, v_effective_payload_hash
  )
  ON CONFLICT (key) DO NOTHING
  RETURNING key INTO v_reserved_key;

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
    IF v_existing.claim_id IS DISTINCT FROM v_claim_id_val THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different claim', p_idempotency_key;
    END IF;
    IF v_existing.payload_hash IS DISTINCT FROM v_effective_payload_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % was used for a different payload', p_idempotency_key;
    END IF;
    IF v_existing.result_id IS NULL THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % exists without a committed result', p_idempotency_key;
    END IF;

    RETURN jsonb_build_object('already_consumed', true, 'result_id', v_existing.result_id, 'new_state', p_next_state);
  END IF;

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

  UPDATE public.idempotency_keys
     SET result_id = v_result_id,
         consumed_at = now(),
         actor = p_actor
   WHERE key = p_idempotency_key
     AND org_id = p_org_id
     AND operation = 'appeal_advance'
     AND payload_hash IS NOT DISTINCT FROM v_effective_payload_hash
     AND result_id IS NULL;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated <> 1 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: reservation lost for key %', p_idempotency_key;
  END IF;

  RETURN jsonb_build_object('already_consumed', false, 'result_id', v_result_id, 'new_state', p_next_state);
END;
$$;

COMMENT ON FUNCTION public.rpc_advance_appeal_case IS
  'Phase 4B Remediation B: Atomic first-use reservation for appeal state advance; concurrent same-key callers return stored result_id.';

REVOKE ALL ON FUNCTION public.rpc_advance_appeal_case FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_advance_appeal_case TO authenticated;
