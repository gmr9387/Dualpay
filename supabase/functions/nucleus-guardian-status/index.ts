// Nucleus Guardian Status Proxy — Edge Function.
//
// Same server-boundary pattern as nucleus-adjudicate/index.ts and
// nucleus-weaver-score/index.ts (see those files' headers): nucleus's
// guardian-status Edge Function is authenticated with an x-api-key
// header that must never reach the browser, so this function is the
// server-side hop that holds the key and proxies the call.
//
// This is additive, not a replacement: nothing in this repo checks it
// yet. Wiring a real gate to it -- e.g. having the claim-submission
// path refuse to run when safe_to_process is false -- is a separate,
// deliberate decision for whoever owns this codebase to make: it's a
// much smaller, safety-only change than swapping calculation logic,
// but it still changes live behavior and deserves its own review.
//
// Required secrets (set via `supabase secrets set`, same as the other
// two nucleus proxies -- never in .env):
//   NUCLEUS_GUARDIAN_STATUS_URL   https://bpqukcsaoporhvdtfyza.supabase.co/functions/v1/guardian-status
//   NUCLEUS_API_KEY               the x-api-key value nucleus issued for this client_id ("dualpay")
//                                 — the SAME key nucleus-adjudicate and nucleus-weaver-score
//                                 use; one credential authorizes all three nucleus endpoints.
//
// NUCLEUS_GUARDIAN_STATUS_URL is named per-function on purpose: Supabase
// Edge Function secrets are project-wide, not scoped to one function, so
// a plain "NUCLEUS_API_URL" would collide with the other two proxies'
// own (different) URL secrets the moment all three are set.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NUCLEUS_API_URL = Deno.env.get('NUCLEUS_GUARDIAN_STATUS_URL');
const NUCLEUS_API_KEY = Deno.env.get('NUCLEUS_API_KEY');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const client = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  if (!NUCLEUS_API_URL || !NUCLEUS_API_KEY) {
    const message =
      'Nucleus Guardian status check is not configured: set NUCLEUS_GUARDIAN_STATUS_URL and NUCLEUS_API_KEY as Edge Function secrets (supabase secrets set ...).';
    await client.from('ops_events').insert([{
      event_id: crypto.randomUUID(),
      occurred_at: new Date().toISOString(),
      kind: 'nucleus_guardian_status_not_configured',
      actor: 'system:nucleus-guardian-status',
      summary: message,
      payload: {},
    }] as never);
    return new Response(JSON.stringify({ error: message }), {
      status: 501,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let nucleusStatus: number | null = null;
  let nucleusError: string | null = null;
  let resultBody: Record<string, unknown> = {};

  try {
    const resp = await fetch(NUCLEUS_API_URL, {
      method: 'GET',
      headers: { 'x-api-key': NUCLEUS_API_KEY },
    });
    nucleusStatus = resp.status;
    resultBody = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      nucleusError = `nucleus guardian-status returned HTTP ${resp.status}: ${JSON.stringify(resultBody)}`;
    }
  } catch (err: unknown) {
    nucleusError = err instanceof Error ? err.message : String(err);
  }

  // Only log non-routine outcomes (not-configured, request failure, or
  // an active kill switch) -- unlike the other two proxies, this one is
  // meant to be polled cheaply and often, so logging every successful
  // "yes it's safe" check would flood ops_events with noise for no
  // operational value.
  const killSwitchActive = resultBody.kill_switch_active === true;
  if (nucleusError || killSwitchActive) {
    await client.from('ops_events').insert([{
      event_id: crypto.randomUUID(),
      occurred_at: new Date().toISOString(),
      kind: nucleusError ? 'nucleus_guardian_status_failed' : 'nucleus_guardian_kill_switch_active',
      actor: 'system:nucleus-guardian-status',
      summary: nucleusError
        ? `Nucleus Guardian status check failed — ${nucleusError}`
        : `Nucleus Guardian kill switch is ACTIVE — reason: ${resultBody.reason ?? 'none given'}`,
      payload: { http_status: nucleusStatus, error: nucleusError, kill_switch_active: killSwitchActive },
    }] as never);
  }

  if (nucleusError) {
    // Propagate nucleus's actual status (401/429/etc.) when we got a
    // real response from it, instead of collapsing every non-2xx reply
    // into a generic 502 -- see nucleus-adjudicate/index.ts's copy of
    // this comment for why.
    return new Response(JSON.stringify({ error: nucleusError }), {
      status: nucleusStatus ?? 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(resultBody), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
