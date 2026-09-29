// servicenow-sync — outbound half of the ServiceNow Case integration.
// Invoked two ways, both via pg_net from Postgres (never directly by a
// browser client):
//   - { case_id, org_id } — fired immediately by the appeal_recovery_cases
//     INSERT/UPDATE triggers (see migration 20260929120000_servicenow_sync.sql)
//   - { sweep: true } — fired every 5 minutes by
//     dualpay.dispatch_servicenow_sync_sweep(), catching anything still
//     'pending' or 'failed' in case the direct dispatch above was dropped.
//
// POSTs to a ServiceNow Scripted REST API (not the raw Table API — see
// docs/SERVICENOW_INTEGRATION.md for that endpoint's server-side script),
// authenticating via OAuth 2.0 client credentials. ServiceNow's own
// correlation_id field carries the DualPay case id, so re-running this for
// an already-synced case updates the same Case instead of duplicating it.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface RecoveryCaseRow {
  id: string;
  organization_id: string;
  claim_id: string;
  current_state: string;
  payer_response_status: string | null;
  recovered_amount_cents: number;
  servicenow_sys_id: string | null;
  servicenow_number: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const instanceUrl = Deno.env.get('SERVICENOW_INSTANCE_URL');
  const clientId = Deno.env.get('SERVICENOW_CLIENT_ID');
  const clientSecret = Deno.env.get('SERVICENOW_CLIENT_SECRET');
  const syncPath = Deno.env.get('SERVICENOW_SYNC_PATH') ?? '/api/x_snc_dualpay/dualpay_sync/case';
  const targetTable = Deno.env.get('SERVICENOW_TARGET_TABLE') ?? 'sn_customerservice_case';

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'dualpay' } },
  );

  if (!instanceUrl || !clientId || !clientSecret) {
    await admin.from('ops_events').insert([{
      event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(),
      kind: 'servicenow_sync_skipped', actor: 'system:servicenow-sync',
      summary: 'ServiceNow sync skipped — SERVICENOW_INSTANCE_URL/CLIENT_ID/CLIENT_SECRET not configured',
      payload: {},
    }] as never);
    return json({ ok: true, synced: 0, skipped: 'servicenow_not_configured' });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  let cases: RecoveryCaseRow[] = [];
  if (typeof body.case_id === 'string') {
    const { data, error } = await admin
      .from('appeal_recovery_cases')
      .select('id, organization_id, claim_id, current_state, payer_response_status, recovered_amount_cents, servicenow_sys_id, servicenow_number')
      .eq('id', body.case_id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (data) cases = [data as RecoveryCaseRow];
  } else if (body.sweep === true) {
    const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
    const { data, error } = await admin
      .from('appeal_recovery_cases')
      .select('id, organization_id, claim_id, current_state, payer_response_status, recovered_amount_cents, servicenow_sys_id, servicenow_number')
      .in('servicenow_sync_status', ['pending', 'failed'])
      .lt('updated_at', cutoff)
      .limit(50);
    if (error) return json({ error: error.message }, 500);
    cases = (data ?? []) as RecoveryCaseRow[];
  } else {
    return json({ error: 'body must include case_id or sweep:true' }, 400);
  }

  if (cases.length === 0) return json({ ok: true, synced: 0 });

  let token: string;
  try {
    token = await getServiceNowToken(instanceUrl, clientId, clientSecret);
  } catch (e) {
    return json({ error: `ServiceNow OAuth token request failed: ${(e as Error).message}` }, 502);
  }

  let synced = 0;
  const errors: Array<{ case_id: string; error: string }> = [];

  for (const c of cases) {
    try {
      const res = await fetch(`${instanceUrl}${syncPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          correlation_id: c.id,
          target_table: targetTable,
          claim_id: c.claim_id,
          state: c.current_state,
          payer_response_status: c.payer_response_status,
          recovered_amount_cents: c.recovered_amount_cents,
          short_description: `DualPay recovery case — claim ${c.claim_id}`,
        }),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resBody.error ?? `ServiceNow returned ${res.status}`);

      const sysId = String(resBody.sys_id ?? '');
      const number = String(resBody.number ?? '');
      if (!sysId) throw new Error('ServiceNow response missing sys_id');

      const { error: updErr } = await admin.from('appeal_recovery_cases').update({
        servicenow_sys_id: sysId,
        servicenow_number: number,
        servicenow_sync_status: 'synced',
        servicenow_synced_at: new Date().toISOString(),
        servicenow_sync_error: null,
      }).eq('id', c.id);
      if (updErr) throw new Error(updErr.message);

      await admin.from('ops_events').insert([{
        event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(),
        kind: 'servicenow_case_synced', actor: 'system:servicenow-sync', org_id: c.organization_id,
        claim_id: c.claim_id,
        summary: `Synced to ServiceNow case ${number || sysId}`,
        payload: { case_id: c.id, servicenow_sys_id: sysId, servicenow_number: number },
      }] as never);

      synced += 1;
    } catch (e) {
      const message = (e as Error).message;
      errors.push({ case_id: c.id, error: message });
      await admin.from('appeal_recovery_cases').update({
        servicenow_sync_status: 'failed',
        servicenow_sync_error: message,
      }).eq('id', c.id);
    }
  }

  return json({ ok: errors.length === 0, synced, errors });
});

async function getServiceNowToken(instanceUrl: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${instanceUrl}/oauth_token.do`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('token response missing access_token');
  return data.access_token as string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
