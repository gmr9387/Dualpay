-- =========================================================
-- ServiceNow sync — bidirectional Case integration
-- =========================================================
-- DualPay side of a two-way integration with ServiceNow Customer Service
-- Management (falls back to Incident if CSM isn't active on the target
-- instance — see docs/SERVICENOW_INTEGRATION.md for the ServiceNow-side
-- artifacts: Scripted REST API, Business Rule, OAuth app, ATF tests).
--
-- Flow:
--   1. A dualpay.appeal_recovery_cases row is created (a claim was denied)
--      or its current_state / payer_response_status changes.
--   2. A trigger fires an async net.http_post to the servicenow-sync Edge
--      Function (Vault-secret gated, same pattern as dispatch_stripe_rollup).
--   3. servicenow-sync authenticates to ServiceNow via OAuth client
--      credentials and POSTs to a Scripted REST API that creates/updates a
--      Case, using ServiceNow's built-in correlation_id field to hold the
--      DualPay case id (no separate cross-reference table needed).
--   4. ServiceNow writes the resulting sys_id/number back onto the row.
--   5. When the Case resolves in ServiceNow, a Business Rule there POSTs to
--      the servicenow-webhook Edge Function, which calls
--      rpc_apply_servicenow_update() to advance the DualPay case.
--   6. sync_origin prevents the echo: an update that originated from
--      ServiceNow does not re-trigger an outbound sync.
-- =========================================================

BEGIN;

-- ── Columns ──────────────────────────────────────────────────────────────

ALTER TABLE dualpay.appeal_recovery_cases
  ADD COLUMN IF NOT EXISTS servicenow_sys_id     text,
  ADD COLUMN IF NOT EXISTS servicenow_number     text,
  ADD COLUMN IF NOT EXISTS servicenow_sync_status text NOT NULL DEFAULT 'pending'
    CHECK (servicenow_sync_status IN ('pending', 'synced', 'failed')),
  ADD COLUMN IF NOT EXISTS servicenow_synced_at  timestamptz,
  ADD COLUMN IF NOT EXISTS servicenow_sync_error text,
  -- One-shot flag: set to 'servicenow' only by rpc_apply_servicenow_update()
  -- in the same statement that applies an inbound update. The BEFORE UPDATE
  -- trigger below consumes it (resets to 'dualpay') so it never leaks into
  -- a later, genuinely DualPay-originated update.
  ADD COLUMN IF NOT EXISTS sync_origin           text NOT NULL DEFAULT 'dualpay'
    CHECK (sync_origin IN ('dualpay', 'servicenow'));

CREATE INDEX IF NOT EXISTS idx_appeal_recovery_cases_servicenow_sys_id
  ON dualpay.appeal_recovery_cases(servicenow_sys_id)
  WHERE servicenow_sys_id IS NOT NULL;

COMMENT ON COLUMN dualpay.appeal_recovery_cases.servicenow_sys_id IS
  'ServiceNow sys_id of the linked Case/Incident. Set by servicenow-sync once ServiceNow accepts the record.';
COMMENT ON COLUMN dualpay.appeal_recovery_cases.sync_origin IS
  'Echo-loop guard. rpc_apply_servicenow_update() sets this to servicenow in the same UPDATE that applies an inbound change; the BEFORE UPDATE trigger consumes it back to dualpay and skips the outbound notify for that one statement.';

-- ── Outbound dispatch: notify_servicenow_sync ───────────────────────────
-- Vault-secret-gated async POST, mirroring dispatch_stripe_rollup's pattern.
-- Safe no-op until dualpay_servicenow_service_role_key is set in Vault.

CREATE OR REPLACE FUNCTION dualpay.notify_servicenow_sync(p_case_id uuid, p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'dualpay', 'extensions', 'public'
AS $function$
declare
  v_key text;
  v_url text := 'https://qrqekucwdfyqqzomuble.supabase.co/functions/v1/servicenow-sync';
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'dualpay_servicenow_service_role_key'
  limit 1;

  if v_key is null then
    raise notice 'dualpay.notify_servicenow_sync: dualpay_servicenow_service_role_key not set in vault, skipping';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('case_id', p_case_id, 'org_id', p_org_id)
  );
end;
$function$;

REVOKE ALL ON FUNCTION dualpay.notify_servicenow_sync(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── Trigger: new recovery case → sync ───────────────────────────────────

CREATE OR REPLACE FUNCTION dualpay.appeal_recovery_cases_servicenow_notify_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'dualpay', 'extensions', 'public'
AS $function$
BEGIN
  PERFORM dualpay.notify_servicenow_sync(NEW.id, NEW.organization_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS appeal_recovery_cases_servicenow_notify_insert ON dualpay.appeal_recovery_cases;
CREATE TRIGGER appeal_recovery_cases_servicenow_notify_insert
  AFTER INSERT ON dualpay.appeal_recovery_cases
  FOR EACH ROW EXECUTE FUNCTION dualpay.appeal_recovery_cases_servicenow_notify_insert();

-- ── Trigger: state change → sync, with echo-loop guard ──────────────────
-- BEFORE UPDATE (not AFTER) because it needs to mutate NEW to consume the
-- sync_origin flag before the row is written.

CREATE OR REPLACE FUNCTION dualpay.appeal_recovery_cases_servicenow_notify_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'dualpay', 'extensions', 'public'
AS $function$
BEGIN
  IF NEW.sync_origin = 'servicenow' AND OLD.sync_origin IS DISTINCT FROM 'servicenow' THEN
    -- This specific statement is the inbound webhook's own update.
    -- Consume the flag so it doesn't suppress the next real DualPay change,
    -- and skip the outbound notify (ServiceNow already knows about this).
    NEW.sync_origin := 'dualpay';
    RETURN NEW;
  END IF;

  IF NEW.current_state IS DISTINCT FROM OLD.current_state
     OR NEW.payer_response_status IS DISTINCT FROM OLD.payer_response_status THEN
    PERFORM dualpay.notify_servicenow_sync(NEW.id, NEW.organization_id);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS appeal_recovery_cases_servicenow_notify_update ON dualpay.appeal_recovery_cases;
CREATE TRIGGER appeal_recovery_cases_servicenow_notify_update
  BEFORE UPDATE ON dualpay.appeal_recovery_cases
  FOR EACH ROW EXECUTE FUNCTION dualpay.appeal_recovery_cases_servicenow_notify_update();

-- ── Reconciliation sweep (resilience net) ───────────────────────────────
-- Retries anything still 'pending' or 'failed' a few minutes after its last
-- attempt, in case the direct net.http_post above was dropped (ServiceNow
-- down, cold start, etc). Runs every 5 minutes; no-ops if nothing is stuck.

CREATE OR REPLACE FUNCTION dualpay.dispatch_servicenow_sync_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'dualpay', 'extensions', 'public'
AS $function$
declare
  v_key text;
  v_url text := 'https://qrqekucwdfyqqzomuble.supabase.co/functions/v1/servicenow-sync';
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'dualpay_servicenow_service_role_key'
  limit 1;

  if v_key is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('sweep', true)
  );
end;
$function$;

REVOKE ALL ON FUNCTION dualpay.dispatch_servicenow_sync_sweep() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'servicenow-sync-sweep',
  '*/5 * * * *',
  $$select dualpay.dispatch_servicenow_sync_sweep();$$
);

-- ── Inbound: rpc_apply_servicenow_update ────────────────────────────────
-- Authoritative write path for ServiceNow-originated updates. Callable only
-- by service_role (the servicenow-webhook Edge Function, after it has
-- already verified the shared-secret header) — no auth.uid() requirement,
-- unlike rpc_advance_appeal_case which is for authenticated in-app users.
-- Uses the same idempotency_keys ledger so a ServiceNow retry is a no-op.

CREATE OR REPLACE FUNCTION dualpay.rpc_apply_servicenow_update(
  p_idempotency_key    text,
  p_case_id            uuid,
  p_org_id             uuid,
  p_expected_state     text,
  p_next_state         text,
  p_servicenow_sys_id  text,
  p_servicenow_number  text,
  p_extra_patch        jsonb DEFAULT NULL,
  p_event_summary      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'dualpay', 'extensions', 'public'
AS $function$
DECLARE
  v_reserved_key  text;
  v_existing      RECORD;
  v_rows_updated  int;
  v_claim_id      text;
  v_event_id      text;
  v_payload_hash  text;
  v_result_id     text;
BEGIN
  IF p_org_id IS NULL OR p_case_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_org_id and p_case_id are required';
  END IF;

  v_payload_hash := md5(jsonb_build_object(
    'operation', 'servicenow_sync', 'case_id', p_case_id, 'org_id', p_org_id,
    'expected_state', p_expected_state, 'next_state', p_next_state,
    'sys_id', p_servicenow_sys_id
  )::text);

  SELECT claim_id INTO v_claim_id
    FROM dualpay.appeal_recovery_cases
   WHERE id = p_case_id AND organization_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: appeal_recovery_case % not in org %', p_case_id, p_org_id;
  END IF;

  INSERT INTO dualpay.idempotency_keys (key, claim_id, org_id, actor, consumed_at, operation, result_id, payload_hash)
  VALUES (p_idempotency_key, v_claim_id, p_org_id, 'system:servicenow-webhook', now(), 'servicenow_sync', NULL, v_payload_hash)
  ON CONFLICT (key) DO NOTHING
  RETURNING key INTO v_reserved_key;

  IF v_reserved_key IS NULL THEN
    SELECT key, org_id, operation, result_id, payload_hash INTO v_existing
      FROM dualpay.idempotency_keys WHERE key = p_idempotency_key FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'IDEMPOTENCY_RETRY: key % could not be loaded after conflict; retry request', p_idempotency_key;
    END IF;
    IF v_existing.org_id IS DISTINCT FROM p_org_id OR v_existing.operation IS DISTINCT FROM 'servicenow_sync' THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % scoped to a different operation/tenant', p_idempotency_key;
    END IF;
    IF v_existing.payload_hash IS DISTINCT FROM v_payload_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key % used for a different payload', p_idempotency_key;
    END IF;
    RETURN jsonb_build_object('already_consumed', true, 'result_id', v_existing.result_id);
  END IF;

  UPDATE dualpay.appeal_recovery_cases
     SET current_state           = p_next_state,
         servicenow_sys_id       = p_servicenow_sys_id,
         servicenow_number       = p_servicenow_number,
         servicenow_sync_status  = 'synced',
         servicenow_synced_at    = now(),
         servicenow_sync_error   = NULL,
         sync_origin             = 'servicenow',
         payer_response_status   = COALESCE(p_extra_patch->>'payer_response_status', payer_response_status),
         recovered_amount_cents  = COALESCE((p_extra_patch->>'recovered_amount_cents')::bigint, recovered_amount_cents),
         updated_at              = now()
   WHERE id = p_case_id
     AND organization_id = p_org_id
     AND current_state = p_expected_state;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION 'STATE_CONFLICT: case % is no longer in state %', p_case_id, p_expected_state;
  END IF;

  v_event_id := 'EV-' || gen_random_uuid()::text;
  INSERT INTO dualpay.ops_events (event_id, occurred_at, kind, claim_id, org_id, actor, summary, payload, created_at)
  VALUES (
    v_event_id, now(), 'servicenow_case_resolved', v_claim_id, p_org_id, 'system:servicenow-webhook',
    COALESCE(p_event_summary, 'ServiceNow case ' || COALESCE(p_servicenow_number, p_servicenow_sys_id) || ' updated DualPay case'),
    jsonb_build_object(
      'servicenow_sys_id', p_servicenow_sys_id, 'servicenow_number', p_servicenow_number,
      'from_state', p_expected_state, 'to_state', p_next_state
    ),
    now()
  );

  v_result_id := 'ARC-' || p_case_id::text || '-' || p_next_state;

  UPDATE dualpay.idempotency_keys
     SET result_id = v_result_id, consumed_at = now()
   WHERE key = p_idempotency_key AND result_id IS NULL;

  RETURN jsonb_build_object('already_consumed', false, 'result_id', v_result_id, 'event_id', v_event_id);
END;
$function$;

REVOKE ALL ON FUNCTION dualpay.rpc_apply_servicenow_update(text, uuid, uuid, text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dualpay.rpc_apply_servicenow_update(text, uuid, uuid, text, text, text, text, jsonb, text) TO service_role;

COMMENT ON FUNCTION dualpay.rpc_apply_servicenow_update IS
  'Authoritative write path for ServiceNow-originated case updates. Callable only by service_role (the servicenow-webhook Edge Function, after shared-secret verification) -- never by an authenticated end user.';

COMMENT ON TABLE dualpay.idempotency_keys IS
  'Idempotency key registry for Phase 4B critical financial mutations, and for ServiceNow inbound sync. All keys must be namespaced: payment:<uuid>, recovery:<uuid>, write_off:<uuid>, appeal:<uuid>, or servicenow:<sys_id>:<state>. Authoritative writes go through rpc_advance_payment_state, rpc_log_recovery_event, rpc_log_write_off, rpc_advance_appeal_case, or rpc_apply_servicenow_update only.';

COMMIT;
