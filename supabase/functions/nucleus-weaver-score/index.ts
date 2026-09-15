// Nucleus Weaver Scoring Proxy — Edge Function.
//
// Same server-boundary pattern as nucleus-adjudicate/index.ts (see that
// file's header): nucleus's weaver-score Edge Function is authenticated
// with an x-api-key header that must never reach the browser, so this
// function is the server-side hop that holds the key and proxies the
// call.
//
// This is additive, not a replacement: nothing in this repo calls it
// yet. Wiring a real call site to use it — e.g. scoring a claim's
// collection-opportunity or auto-approve confidence using nucleus's
// live, admin-editable weaver_rules instead of this repo's own
// heuristics in automation-rules.ts / next-action.ts — is a separate,
// deliberate decision for whoever owns this codebase to make.
//
// Required secrets (set via `supabase secrets set`, same as
// nucleus-adjudicate — never in .env):
//   NUCLEUS_API_URL   e.g. https://bpqukcsaoporhvdtfyza.supabase.co/functions/v1/weaver-score
//   NUCLEUS_API_KEY   the x-api-key value nucleus issued for this client_id ("dualpay")
//                      — the SAME key nucleus-adjudicate uses; one credential
//                      authorizes both nucleus endpoints.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NUCLEUS_API_URL = Deno.env.get('NUCLEUS_API_URL');
const NUCLEUS_API_KEY = Deno.env.get('NUCLEUS_API_KEY');

interface NucleusWeaverScoreRequest {
  stage: 'opportunity' | 'recommendation';
  claim_id?: string;
  facts?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const client = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  if (!NUCLEUS_API_URL || !NUCLEUS_API_KEY) {
    const message =
      'Nucleus Weaver scoring is not configured: set NUCLEUS_API_URL and NUCLEUS_API_KEY as Edge Function secrets (supabase secrets set ...).';
    await client.from('ops_events').insert([{
      event_id: crypto.randomUUID(),
      occurred_at: new Date().toISOString(),
      kind: 'nucleus_weaver_score_not_configured',
      actor: 'system:nucleus-weaver-score',
      summary: message,
      payload: {},
    }] as never);
    return new Response(JSON.stringify({ error: message }), {
      status: 501,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: NucleusWeaverScoreRequest;
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
      nucleusError = `nucleus weaver-score returned HTTP ${resp.status}: ${JSON.stringify(resultBody)}`;
    }
  } catch (err: unknown) {
    nucleusError = err instanceof Error ? err.message : String(err);
  }

  await client.from('ops_events').insert([{
    event_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    kind: nucleusError ? 'nucleus_weaver_score_failed' : 'nucleus_weaver_score_completed',
    actor: 'system:nucleus-weaver-score',
    summary: nucleusError
      ? `Nucleus Weaver scoring failed for stage ${body.stage} — ${nucleusError}`
      : `Nucleus Weaver scoring completed for stage ${body.stage} — action=${resultBody.action ?? 'n/a'} score=${resultBody.score ?? resultBody.confidence ?? 'n/a'}`,
    payload: { claim_id: body.claim_id ?? null, stage: body.stage, http_status: nucleusStatus, error: nucleusError },
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
