// servicenow-webhook — inbound half of the ServiceNow Case integration.
// Called by a ServiceNow Business Rule when a synced Case resolves (see
// docs/SERVICENOW_INTEGRATION.md for that Business Rule's script). Verifies
// a shared-secret bearer token itself (ServiceNow can't produce a Supabase
// JWT), so this function must be deployed with verify_jwt=false — same
// reasoning as stripe-webhook.
//
// Expected body: { correlation_id, sys_id, number, resolution_code, event_id?, resolution_notes? }
//   - correlation_id: the dualpay.appeal_recovery_cases.id ServiceNow was given at create time
//   - resolution_code: 'recovered' | 'closed_no_recovery' | 'needs_more_info'
//   - event_id: a per-firing GUID from the Business Rule (gs.generateGUID()), used for
//     idempotency so a ServiceNow retry doesn't double-apply
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const RESOLUTION_TO_STATE: Record<string, string> = {
  recovered: 'recovered',
  closed_no_recovery: 'closed',
  needs_more_info: 'submitted',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sharedSecret = Deno.env.get('SERVICENOW_WEBHOOK_SECRET');
  if (!sharedSecret) return json({ error: 'ServiceNow webhook is not configured yet' }, 503);

  const authHeader = req.headers.get('Authorization') ?? '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!timingSafeEqual(provided, sharedSecret)) {
    return json({ error: 'invalid or missing bearer token' }, 401);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.correlation_id !== 'string') {
    return json({ error: 'correlation_id is required' }, 400);
  }
  const nextState = RESOLUTION_TO_STATE[String(body.resolution_code)];
  if (!nextState) {
    return json({ error: `unknown resolution_code: ${body.resolution_code}` }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'dualpay' } },
  );

  const { data: caseRow, error: caseErr } = await admin
    .from('appeal_recovery_cases')
    .select('id, organization_id, current_state')
    .eq('id', body.correlation_id)
    .maybeSingle();
  if (caseErr) return json({ error: caseErr.message }, 500);
  if (!caseRow) return json({ error: `no appeal_recovery_case for correlation_id ${body.correlation_id}` }, 404);

  const idempotencyKey = typeof body.event_id === 'string' && body.event_id
    ? `servicenow:${body.event_id}`
    : `servicenow:${body.sys_id ?? 'unknown'}:${body.resolution_code}:${Date.now()}`;

  const { data: rpcData, error: rpcErr } = await admin.rpc('rpc_apply_servicenow_update', {
    p_idempotency_key: idempotencyKey,
    p_case_id: caseRow.id,
    p_org_id: caseRow.organization_id,
    p_expected_state: caseRow.current_state,
    p_next_state: nextState,
    p_servicenow_sys_id: String(body.sys_id ?? ''),
    p_servicenow_number: String(body.number ?? ''),
    p_extra_patch: null,
    p_event_summary: body.resolution_notes ? String(body.resolution_notes) : null,
  } as never);

  if (rpcErr) {
    const status = rpcErr.message.startsWith('STATE_CONFLICT') ? 409
      : rpcErr.message.startsWith('NOT_FOUND') ? 404
      : 500;
    return json({ error: rpcErr.message }, status);
  }

  return json({ ok: true, result: rpcData });
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
