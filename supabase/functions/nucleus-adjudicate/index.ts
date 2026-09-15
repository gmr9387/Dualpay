// Nucleus Adjudication Proxy — Edge Function.
//
// DualPay's own adjudication engine (src/engine/calculation-engine.ts,
// via adjudication-orchestrator.ts) runs entirely client-side today,
// with no server boundary at all. Nucleus's equivalent engine now
// exposes a real external API (adjudicate-claim), authenticated with an
// x-api-key header — but that key must never reach the browser, or it
// leaks to every user's bundle. This function is the server-side hop
// that holds the key and proxies the call, the same pattern
// scheduler-dispatcher already uses for worker-dispatcher (env-based
// secrets, ops_events audit, never a hardcoded literal).
//
// This is additive, not a replacement: it does not change what
// ClaimsWorkbench.tsx / Index.tsx / case-management.ts call today.
// Wiring the UI to call this instead of the local engine is a separate,
// deliberate decision for whoever owns this codebase to make — it
// changes DualPay's live financial-calculation path and deserves review
// on its own, not a drive-by swap alongside this proxy's plumbing.
//
// Required secrets (set via `supabase secrets set`, never in .env —
// see .env.example's own convention: only VITE_-prefixed vars belong
// there, since those get bundled into the client):
//   NUCLEUS_API_URL   e.g. https://bpqukcsaoporhvdtfyza.supabase.co/functions/v1/adjudicate-claim
//   NUCLEUS_API_KEY   the x-api-key value nucleus issued for this client_id ("dualpay")
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NUCLEUS_API_URL = Deno.env.get('NUCLEUS_API_URL');
const NUCLEUS_API_KEY = Deno.env.get('NUCLEUS_API_KEY');

interface NucleusAdjudicateRequest {
  claim_id: string;
  member_id: string;
  payer_name: string;
  procedure_code: string;
  plan_year?: number;
  provider_npi?: string;
  diagnosis_codes?: string[];
  billed_amount_cents: number;
  units?: number;
  place_of_service?: string;
  service_date?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const client = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  if (!NUCLEUS_API_URL || !NUCLEUS_API_KEY) {
    const message =
      'Nucleus adjudication is not configured: set NUCLEUS_API_URL and NUCLEUS_API_KEY as Edge Function secrets (supabase secrets set ...).';
    await client.from('ops_events').insert([{
      event_id: crypto.randomUUID(),
      occurred_at: new Date().toISOString(),
      kind: 'nucleus_adjudicate_not_configured',
      actor: 'system:nucleus-adjudicate',
      summary: message,
      payload: {},
    }] as never);
    return new Response(JSON.stringify({ error: message }), {
      status: 501,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: NucleusAdjudicateRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let nucleusStatus: number | null = null;
  let nucleusError: string | null = null;
  let resultBody: Record<string, unknown> = {};

  try {
    const resp = await fetch(NUCLEUS_API_URL, {
      method: 'POST',
      headers: { 'x-api-key': NUCLEUS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    nucleusStatus = resp.status;
    resultBody = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      nucleusError = `nucleus adjudicate-claim returned HTTP ${resp.status}: ${JSON.stringify(resultBody)}`;
    }
  } catch (err: unknown) {
    nucleusError = err instanceof Error ? err.message : String(err);
  }

  await client.from('ops_events').insert([{
    event_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    kind: nucleusError ? 'nucleus_adjudicate_failed' : 'nucleus_adjudicate_completed',
    actor: 'system:nucleus-adjudicate',
    summary: nucleusError
      ? `Nucleus adjudication failed for claim ${body.claim_id} — ${nucleusError}`
      : `Nucleus adjudication completed for claim ${body.claim_id} — decision=${resultBody.decision}`,
    payload: { claim_id: body.claim_id, http_status: nucleusStatus, error: nucleusError, decision: resultBody.decision ?? null },
  }] as never);

  if (nucleusError) {
    return new Response(JSON.stringify({ error: nucleusError }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(resultBody), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
