// audit-export — server-side enforcement for the Audit Export feature
// (RISK_REGISTER #65). The prior implementation (src/lib/audit-export.ts)
// queried dualpay tables directly from the browser and did role-gating,
// PHI redaction, and audit-logging entirely in client JS -- all bypassable
// by a low-privilege, authenticated org member calling the Supabase client
// directly instead of going through AdminAudit.tsx. This function is now
// the only path: it re-checks the caller's org role against the requested
// mode server-side, performs the redaction and row-cap server-side, and
// writes the audit_export_requested/completed ops_events itself so a
// direct-API bypass can no longer skip any of it.
//
// This does not change who can read individual ops_events/recovery_outcomes/
// claim_assignments rows through other, unrelated screens -- that's a
// broader base-RLS design question (every legitimate lower-role read path
// would need auditing before tightening those policies) tracked separately.
// This closes the export feature's own gate specifically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const DATASETS = new Set(['ops_events', 'escalations', 'assignments', 'recovery_outcomes', 'evidence_actions']);
const FORMATS = new Set(['csv', 'json']);
const MODES = new Set(['full', 'redacted']);
const ROW_CAP = 10000;

const PII_FIELDS = new Set([
  'member_id', 'member_name', 'first_name', 'last_name', 'dob', 'ssn',
  'phone', 'email', 'address', 'address_line_1', 'address_line_2',
  'mrn', 'subscriber_id', 'patient_id',
]);
const SENSITIVE_FILE_FIELDS = new Set(['filename', 'original_filename', 'storage_path']);

function redact(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (PII_FIELDS.has(k) || SENSITIVE_FILE_FIELDS.has(k)) { out[k] = '[REDACTED]'; continue; }
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? redact(v as Record<string, unknown>) : v;
  }
  return out;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Array.from(rows.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set<string>()));
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map(h => esc(r[h])).join(','));
  return lines.join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'missing bearer token' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, db: { schema: 'dualpay' } });
    const { data: userRes, error: uErr } = await asCaller.auth.getUser();
    if (uErr || !userRes.user) return json({ error: 'not authenticated' }, 401);
    const caller = userRes.user;

    const body = await req.json().catch(() => ({}));
    const orgId = String(body.org_id ?? '');
    const dataset = String(body.dataset ?? '');
    const format = String(body.format ?? 'csv');
    const mode = String(body.mode ?? 'redacted');
    const from = body.from ? String(body.from) : undefined;
    const to = body.to ? String(body.to) : undefined;

    if (!orgId) return json({ error: 'org_id required' }, 400);
    if (!DATASETS.has(dataset)) return json({ error: 'invalid dataset' }, 400);
    if (!FORMATS.has(format)) return json({ error: 'invalid format' }, 400);
    if (!MODES.has(mode)) return json({ error: 'invalid mode' }, 400);

    const admin = createClient(url, service, { db: { schema: 'dualpay' } });

    // Server-side role check -- the actual security boundary. Mirrors
    // RequireRole min="manager" on the page and the isAdmin gate on
    // full-mode, but can no longer be bypassed by calling this (or the
    // underlying tables) directly with a lower-privilege token.
    const { data: mem, error: mErr } = await admin
      .from('organization_members')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', caller.id)
      .maybeSingle();
    if (mErr) return json({ error: mErr.message }, 500);
    const role = mem?.role ?? null;
    const MANAGER_UP = new Set(['manager', 'admin', 'owner']);
    const ADMIN_UP = new Set(['admin', 'owner']);
    if (!role || !MANAGER_UP.has(role)) return json({ error: 'forbidden: manager role or higher required' }, 403);
    if (mode === 'full' && !ADMIN_UP.has(role)) return json({ error: 'forbidden: full (unredacted) exports require admin or owner' }, 403);

    async function logEvent(kind: string, summary: string, payload: Record<string, unknown>) {
      await admin.from('ops_events').insert([{
        event_id: crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        kind,
        org_id: orgId,
        actor: caller.email ?? 'system',
        actor_user_id: caller.id,
        actor_email: caller.email ?? null,
        actor_name: (caller.user_metadata?.full_name as string | undefined) ?? (caller.user_metadata?.name as string | undefined) ?? null,
        summary,
        payload,
      }]);
    }

    await logEvent('audit_export_requested', `Audit export requested: ${dataset} (${format}, ${mode})`, { dataset, format, mode, from: from ?? null, to: to ?? null });

    // dateColumn is null for 'assignments' -- claim_assignments has no
    // occurred_at/resolution_date equivalent, and the prior implementation
    // never applied from/to filtering to it either.
    let dateColumn: string | null = null;
    let q;
    switch (dataset) {
      case 'ops_events':
        dateColumn = 'occurred_at';
        q = admin.from('ops_events').select('*').eq('org_id', orgId).order('occurred_at', { ascending: false }).limit(ROW_CAP);
        break;
      case 'escalations':
        dateColumn = 'occurred_at';
        q = admin.from('ops_events').select('*').eq('org_id', orgId).in('kind', ['escalation_raised', 'escalation_resolved']).order('occurred_at', { ascending: false }).limit(ROW_CAP);
        break;
      case 'assignments':
        q = admin.from('claim_assignments').select('*').eq('org_id', orgId).limit(ROW_CAP);
        break;
      case 'recovery_outcomes':
        dateColumn = 'resolution_date';
        q = admin.from('recovery_outcomes').select('*').eq('org_id', orgId).order('resolution_date', { ascending: false }).limit(ROW_CAP);
        break;
      case 'evidence_actions':
        dateColumn = 'occurred_at';
        q = admin.from('ops_events').select('*').eq('org_id', orgId).in('kind', ['document_uploaded', 'document_updated', 'document_linked', 'document_removed', 'appeal_packet_generated']).order('occurred_at', { ascending: false }).limit(ROW_CAP);
        break;
    }
    if (dateColumn && from) q = q!.gte(dateColumn, from);
    if (dateColumn && to) q = q!.lte(dateColumn, to);

    const { data: raw, error: qErr } = await q!;
    if (qErr) return json({ error: qErr.message }, 500);

    const rows = mode === 'redacted' ? (raw ?? []).map(redact) : (raw ?? []);
    const body_ = format === 'json' ? JSON.stringify(rows, null, 2) : toCsv(rows);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `clarity-${dataset}-${mode}-${ts}.${format}`;

    await logEvent('audit_export_completed', `Audit export completed: ${dataset} — ${rows.length} rows (${mode})`, { dataset, format, mode, row_count: rows.length, filename });

    return json({
      ok: true, dataset, format, mode,
      rowCount: rows.length, filename, content: body_,
      disclaimer: mode === 'redacted'
        ? 'Redacted export: member identifiers, personal identifiers, and sensitive filenames removed. Suitable for vendor/regulator sharing where PHI is not permitted.'
        : 'This export may contain Protected Health Information (PHI). Treat per your BAA and HIPAA policies.',
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
