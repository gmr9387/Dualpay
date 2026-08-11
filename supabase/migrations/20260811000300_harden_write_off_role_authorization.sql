-- Migration: Harden rpc_log_write_off role authorization
--
-- Replaces the `is_org_member` membership check with a `has_org_role` role
-- check, restricting write-off to analyst, manager, admin, and owner roles.
-- Write-off is a financially destructive operation and requires explicit role
-- authorization beyond simple org membership.
--
-- Before: any org member (including viewer) could invoke write-off.
-- After:  only analyst, manager, admin, or owner may invoke write-off.

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
  IF NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['analyst','manager','admin','owner']) THEN
    RAISE EXCEPTION 'FORBIDDEN: write-off requires analyst, manager, admin, or owner role in org %', p_org_id;
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
  'Phase 4B Write-off Authorization Hardening: Write-off restricted to analyst/manager/admin/owner roles; '
  'simple org membership is insufficient for this financially destructive operation.';

REVOKE ALL ON FUNCTION public.rpc_log_write_off FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_log_write_off TO authenticated;
