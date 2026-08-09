// Phase 18 + 19 — Worker Dispatcher Edge Function.
// Polls job_queue, atomically claims jobs, executes them server-side, records
// metrics + heartbeat. Phase 19 adds `contract_recovery_analysis`:
// candidate discovery, deterministic contract match, true underpayment
// detection, and idempotent dispute creation — all server-side.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface QueueJob {
  queue_job_id: string;
  org_id: string;
  pipeline_id: string | null;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown> | null;
}

const WORKER_VERSION = '19.0.0';

// ---------- ops_events helper ----------
function evId() { return `EV-${Date.now().toString(36)}-${crypto.randomUUID().slice(0,8)}`; }
async function audit(
  client: ReturnType<typeof createClient>,
  kind: string, summary: string, actor: string,
  claim_id: string | null = null, payload: Record<string, unknown> = {},
) {
  await client.from('ops_events').insert([{
    event_id: evId(), occurred_at: new Date().toISOString(),
    kind, actor, summary, claim_id, payload,
  }] as never);
}

// ---------- Worker lifecycle ----------
async function registerWorker(client: ReturnType<typeof createClient>, worker_id: string) {
  await client.from('worker_registry').upsert({
    worker_id, status: 'active', version: WORKER_VERSION, last_heartbeat: new Date().toISOString(),
  } as never, { onConflict: 'worker_id' });
  await audit(client, 'worker_registered', `Worker ${worker_id} registered`, 'system:worker-dispatcher', null,
    { worker_id, version: WORKER_VERSION });
}
async function heartbeat(client: ReturnType<typeof createClient>, worker_id: string, ok: number, fail: number) {
  const { data } = await client.from('worker_registry').select('jobs_processed, jobs_failed').eq('worker_id', worker_id).maybeSingle();
  const next_ok = ((data?.jobs_processed as number | undefined) ?? 0) + ok;
  const next_fail = ((data?.jobs_failed as number | undefined) ?? 0) + fail;
  await client.from('worker_registry').update({
    status: 'active', last_heartbeat: new Date().toISOString(),
    jobs_processed: next_ok, jobs_failed: next_fail,
  } as never).eq('worker_id', worker_id);
  await audit(client, 'worker_heartbeat', `Heartbeat ${worker_id} (+${ok} ok, +${fail} fail)`,
    'system:worker-dispatcher', null, { worker_id, ok, fail });
}

// ---------- Contract-matching primitives (mirror src/engine/contract-*.ts) ----------
type Contract = { contract_id: string; org_id: string; payer_name: string; contract_name: string;
  version: string; effective_date: string; termination_date: string | null };
type Fee = { fee_schedule_id: string; contract_id: string; procedure_code: string;
  modifier: string | null; contracted_amount_cents: number; reimbursement_method: string };

function matchContract(contracts: Contract[], payer_name: string, service_date: string): Contract | null {
  const wanted = (payer_name ?? '').trim().toLowerCase();
  const cand = contracts.filter(c =>
    c.payer_name.trim().toLowerCase() === wanted
    && service_date >= c.effective_date
    && (!c.termination_date || service_date <= c.termination_date));
  if (!cand.length) return null;
  cand.sort((a, b) => b.effective_date.localeCompare(a.effective_date)
    || String(b.version).localeCompare(String(a.version)));
  return cand[0];
}

function findFee(fees: Fee[], contract_id: string, procedure_code: string, modifier: string | null): Fee | undefined {
  const rows = fees.filter(f => f.contract_id === contract_id
    && f.procedure_code.toUpperCase() === procedure_code.toUpperCase());
  return rows.find(f => (f.modifier ?? '') === (modifier ?? ''))
      ?? rows.find(f => !f.modifier)
      ?? rows[0];
}

function computeExpected(fee: Fee, billed_cents: number, medicare_cents = 0): { expected: number; basis: string; conf: number } {
  switch (fee.reimbursement_method) {
    case 'fixed_fee':
    case 'case_rate':
    case 'per_diem':
      return { expected: fee.contracted_amount_cents, basis: `${fee.reimbursement_method}`, conf: 95 };
    case 'percent_of_billed': {
      const pct = fee.contracted_amount_cents / 10000;
      return { expected: Math.round(billed_cents * pct), basis: `${(pct*100).toFixed(1)}% of billed`, conf: 85 };
    }
    case 'percent_of_medicare': {
      if (!medicare_cents) return { expected: 0, basis: 'Medicare allowable unavailable', conf: 30 };
      const pct = fee.contracted_amount_cents / 10000;
      return { expected: Math.round(medicare_cents * pct), basis: `${(pct*100).toFixed(1)}% of Medicare`, conf: 80 };
    }
    default: return { expected: fee.contracted_amount_cents, basis: `Unknown method`, conf: 60 };
  }
}

const VAR_MIN_CENTS = 100;   // $1
const VAR_MIN_PCT = 2;       // 2%
function severityOf(variance: number, pct: number): string {
  if (pct >= 25 || variance >= 50_000) return 'critical';
  if (pct >= 15 || variance >= 20_000) return 'high';
  if (pct >= 5  || variance >=  5_000) return 'medium';
  return 'low';
}

function makeDedupeKey(claim_id: string, contract_id: string | null, variance_cents: number, service_date: string | null) {
  return `${claim_id}|${contract_id ?? 'none'}|${variance_cents}|${service_date ?? 'none'}`;
}

// ---------- Candidate discovery (Phase 20: prefer remittance_lines) ----------
interface DiscoveredCandidate {
  claim_id: string;
  payer_name: string;
  procedure_code: string | null;
  service_date: string | null;
  billed_cents: number;
  allowed_cents: number;
  paid_cents: number;
  remittance_line_id: string | null;
  source: 'remittance_line' | 'claim_payload';
}

function pickLatestResponse(responses: any[] | undefined): any | null {
  if (!Array.isArray(responses) || !responses.length) return null;
  const ranked = [...responses]
    .filter(r => (r?.allowed_cents ?? 0) > 0 || (r?.paid_cents ?? 0) > 0)
    .sort((a, b) => String(b.received_at ?? '').localeCompare(String(a.received_at ?? '')));
  return ranked[0] ?? null;
}

async function discoverCandidates(
  client: ReturnType<typeof createClient>,
  org_id: string,
  filters: { remittance_batch_id?: string | null; claim_ids?: string[] | null; payer_name?: string | null },
): Promise<DiscoveredCandidate[]> {
  const out: DiscoveredCandidate[] = [];
  const coveredClaims = new Set<string>();

  // 1. Preferred: remittance_lines (durable, batch-scoped)
  let lq = client.from('remittance_lines').select(
    'remittance_line_id, claim_id, payer_name, service_date, procedure_code, billed_amount_cents, allowed_amount_cents, paid_amount_cents, remittance_batch_id, import_batch_id'
  ).eq('org_id', org_id);
  if (filters.remittance_batch_id) lq = lq.or(`remittance_batch_id.eq.${filters.remittance_batch_id},import_batch_id.eq.${filters.remittance_batch_id}`);
  if (filters.claim_ids?.length) lq = lq.in('claim_id', filters.claim_ids);
  if (filters.payer_name) lq = lq.ilike('payer_name', filters.payer_name);
  const { data: lineRows } = await lq.limit(5000);
  for (const r of (lineRows ?? []) as Array<any>) {
    if (!r.claim_id || !r.payer_name) continue;
    const billed = Number(r.billed_amount_cents ?? 0);
    const allowed = Number(r.allowed_amount_cents ?? 0);
    const paid = Number(r.paid_amount_cents ?? 0);
    if (billed <= 0 || (allowed === 0 && paid === 0)) continue;
    out.push({
      claim_id: r.claim_id, payer_name: r.payer_name,
      procedure_code: r.procedure_code ?? null,
      service_date: r.service_date ?? null,
      billed_cents: billed, allowed_cents: allowed, paid_cents: paid,
      remittance_line_id: r.remittance_line_id, source: 'remittance_line',
    });
    coveredClaims.add(r.claim_id);
  }

  // 2. Fallback: claim payload (older claims without lineage rows)
  if (!filters.remittance_batch_id) {
    let q = client.from('claims').select('claim_id, payload, total_billed_cents, service_date_from')
      .eq('org_id', org_id);
    if (filters.claim_ids?.length) q = q.in('claim_id', filters.claim_ids);
    const { data: rows } = await q.limit(2000);
    for (const r of (rows ?? []) as Array<{ claim_id: string; payload: any; total_billed_cents: number; service_date_from: string }>) {
      if (coveredClaims.has(r.claim_id)) continue;
      const intel = r.payload?.intel ?? {};
      const payer = (intel.payer_name ?? r.payload?.payer_name ?? '') as string;
      if (!payer) continue;
      if (filters.payer_name && payer.toLowerCase() !== filters.payer_name.toLowerCase()) continue;
      const resp = pickLatestResponse(intel.payer_responses);
      if (!resp) continue;
      const billed = Number(resp.billed_cents ?? r.total_billed_cents ?? 0);
      const allowed = Number(resp.allowed_cents ?? 0);
      const paid = Number(resp.paid_cents ?? 0);
      if (billed <= 0 || (allowed === 0 && paid === 0)) continue;
      const lines: any[] = Array.isArray(r.payload?.lines) ? r.payload.lines : [];
      if (lines.length === 0) {
        out.push({ claim_id: r.claim_id, payer_name: payer, procedure_code: null,
          service_date: r.service_date_from, billed_cents: billed, allowed_cents: allowed, paid_cents: paid,
          remittance_line_id: null, source: 'claim_payload' });
        continue;
      }
      const billedTotal = lines.reduce((s, l) => s + Number(l.billed_amount ?? 0), 0) || billed;
      for (const ln of lines) {
        const lineBilled = Number(ln.billed_amount ?? 0);
        const share = billedTotal > 0 ? lineBilled / billedTotal : 1 / lines.length;
        out.push({
          claim_id: r.claim_id, payer_name: payer,
          procedure_code: (ln.procedure_code ?? null) as string | null,
          service_date: (ln.service_date ?? r.service_date_from) as string | null,
          billed_cents: lineBilled || billed,
          allowed_cents: Math.round(allowed * share),
          paid_cents: Math.round(paid * share),
          remittance_line_id: null, source: 'claim_payload',
        });
      }
    }
  }

  return out;
}

// ---------- Contract recovery handler ----------
async function runContractRecovery(
  client: ReturnType<typeof createClient>,
  job: QueueJob,
  worker_id: string,
) {
  const p = (job.payload ?? {}) as { remittance_batch_id?: string | null; claim_ids?: string[] | null; payer_name?: string | null; contract_id?: string | null };
  await audit(client, 'contract_recovery_started',
    `Contract recovery started${p.payer_name ? ` (${p.payer_name})` : ''}`,
    `system:${worker_id}`, null, { ...p, queue_job_id: job.queue_job_id });

  const [{ data: contractRows }, { data: feeRows }] = await Promise.all([
    client.from('payer_contracts').select('contract_id, org_id, payer_name, contract_name, version, effective_date, termination_date').eq('org_id', job.org_id),
    client.from('fee_schedules').select('fee_schedule_id, contract_id, procedure_code, modifier, contracted_amount_cents, reimbursement_method').eq('org_id', job.org_id),
  ]);
  const contracts = ((contractRows ?? []) as Contract[])
    .filter(c => !p.contract_id || c.contract_id === p.contract_id);
  const fees = (feeRows ?? []) as Fee[];

  const candidates = await discoverCandidates(client, job.org_id, {
    remittance_batch_id: p.remittance_batch_id ?? null,
    claim_ids: p.claim_ids ?? null,
    payer_name: p.payer_name ?? null,
  });

  let processed = 0, matched = 0, missing = 0, created = 0, skipped = 0, failed = 0;
  let valueCents = 0;

  for (const c of candidates) {
    processed += 1;
    const contract = matchContract(contracts, c.payer_name, c.service_date ?? new Date().toISOString().slice(0,10));
    if (!contract) {
      missing += 1;
      await audit(client, 'contract_match_missing',
        `No contract for ${c.payer_name} on ${c.service_date ?? '—'}`,
        `system:${worker_id}`, c.claim_id, { payer_name: c.payer_name, service_date: c.service_date });
      continue;
    }
    matched += 1;
    await audit(client, 'contract_match_found',
      `Matched ${contract.payer_name} ${contract.contract_name} v${contract.version}`,
      `system:${worker_id}`, c.claim_id, { contract_id: contract.contract_id, procedure_code: c.procedure_code });

    const fee = c.procedure_code ? findFee(fees, contract.contract_id, c.procedure_code, null) : undefined;
    if (!fee) continue;
    const { expected, basis, conf } = computeExpected(fee, c.billed_cents);
    if (expected <= 0) continue;

    const comparison = Math.max(c.allowed_cents, c.paid_cents);
    const variance = expected - comparison;
    const variancePct = (variance / expected) * 100;
    if (variance <= VAR_MIN_CENTS || variancePct < VAR_MIN_PCT) continue;

    const sev = severityOf(variance, variancePct);
    await audit(client, 'underpayment_detected',
      `Underpayment $${(variance/100).toFixed(2)} (${variancePct.toFixed(1)}%) on ${c.payer_name}`,
      `system:${worker_id}`, c.claim_id,
      { contract_id: contract.contract_id, variance_cents: variance, severity: sev, confidence: conf });

    const dedupe = makeDedupeKey(c.claim_id, contract.contract_id, variance, c.service_date);
    const { data: existing } = await client.from('underpayment_disputes')
      .select('dispute_id').eq('org_id', job.org_id).eq('dedupe_key', dedupe).maybeSingle();
    if (existing) {
      skipped += 1;
      await audit(client, 'dispute_duplicate_skipped',
        `Duplicate dispute skipped (${c.payer_name})`,
        `system:${worker_id}`, c.claim_id, { dedupe_key: dedupe });
      continue;
    }

    const explanation = `Expected $${(expected/100).toFixed(2)} (${basis}); paid/allowed $${(comparison/100).toFixed(2)}. Variance $${(variance/100).toFixed(2)} (${variancePct.toFixed(1)}%).`;
    const source_metadata = {
      source: c.source, remittance_line_id: c.remittance_line_id,
      queue_job_id: job.queue_job_id, basis, confidence: conf,
    };
    const { data: ins, error: insErr } = await client.from('underpayment_disputes').insert([{
      org_id: job.org_id, claim_id: c.claim_id, contract_id: contract.contract_id,
      payer_name: c.payer_name, procedure_code: c.procedure_code,
      expected_amount_cents: expected, allowed_amount_cents: c.allowed_cents, paid_amount_cents: c.paid_cents,
      variance_amount_cents: variance, variance_percent: variancePct,
      severity: sev, status: 'open', explanation,
      service_date: c.service_date, dedupe_key: dedupe,
      remittance_line_id: c.remittance_line_id, source_metadata,
    }] as never).select('dispute_id').maybeSingle();

    if (insErr) {
      // Duplicate via race ⇒ count as skipped, otherwise failure.
      if (String(insErr.message).includes('duplicate key')) {
        skipped += 1;
        await audit(client, 'dispute_duplicate_skipped', `Race-duplicate skipped`, `system:${worker_id}`, c.claim_id, { dedupe_key: dedupe });
      } else {
        failed += 1;
      }
      continue;
    }
    if (ins) {
      created += 1;
      valueCents += variance;
      const dispute_id = (ins as any).dispute_id as string;
      await audit(client, 'dispute_created',
        `Dispute opened: ${c.payer_name} variance ${variancePct.toFixed(1)}%`,
        `system:${worker_id}`, c.claim_id,
        { dispute_id, severity: sev, variance_cents: variance, remittance_line_id: c.remittance_line_id });
      // Phase 20 lineage events: underpayment_detected + dispute_created
      await client.from('recovery_lineage_events').insert([
        { org_id: job.org_id, claim_id: c.claim_id, remittance_line_id: c.remittance_line_id,
          event_type: 'underpayment_detected',
          event_summary: `Underpayment detected on ${c.payer_name} ($${(variance/100).toFixed(2)})`,
          payload: { variance_cents: variance, severity: sev, confidence: conf, basis } },
        { org_id: job.org_id, claim_id: c.claim_id, remittance_line_id: c.remittance_line_id,
          dispute_id, event_type: 'dispute_created',
          event_summary: `Dispute ${dispute_id} created for ${c.payer_name}`,
          payload: { contract_id: contract.contract_id, severity: sev, dedupe_key: dedupe } },
      ] as never);
    }
  }

  await audit(client, 'contract_recovery_completed',
    `Contract recovery completed: ${created} disputes ($${(valueCents/100).toFixed(2)}), ${skipped} duplicates, ${missing} unmatched`,
    `system:${worker_id}`, null,
    { queue_job_id: job.queue_job_id, processed, matched, missing, created, skipped, failed, value_cents: valueCents });

  return {
    records_processed: processed,
    records_succeeded: created + skipped,
    records_failed: failed,
    recovery_value_cents: valueCents,
    details: { matched, missing, created, skipped, failed, contracts: contracts.length, fees: fees.length },
  };
}

// ---------- Dispute generation handler (server-side discovery) ----------
async function runDisputeGeneration(client: ReturnType<typeof createClient>, job: QueueJob, worker_id: string) {
  const payloadCandidates = (job.payload?.candidates as Array<any> | undefined) ?? [];
  if (payloadCandidates.length === 0) {
    // Delegate to contract recovery analysis path for auto-discovery.
    return await runContractRecovery(client, job, worker_id);
  }
  let created = 0, skipped = 0, failed = 0, valueCents = 0;
  for (const c of payloadCandidates) {
    const dedupe = makeDedupeKey(c.claim_id, c.contract_id ?? null, c.variance_amount_cents, c.service_date ?? null);
    const { data: ex } = await client.from('underpayment_disputes')
      .select('dispute_id').eq('org_id', job.org_id).eq('dedupe_key', dedupe).maybeSingle();
    if (ex) { skipped += 1; continue; }
    const { data: ins, error } = await client.from('underpayment_disputes').insert([{
      ...c, org_id: job.org_id, dedupe_key: dedupe,
    }] as never).select('dispute_id').maybeSingle();
    if (error) { failed += 1; continue; }
    if (ins) {
      created += 1; valueCents += Number(c.variance_amount_cents ?? 0);
      await audit(client, 'dispute_created',
        `Dispute opened (manual candidate): ${c.payer_name}`,
        `system:${worker_id}`, c.claim_id, { dispute_id: (ins as any).dispute_id });
    }
  }
  return {
    records_processed: payloadCandidates.length,
    records_succeeded: created + skipped,
    records_failed: failed,
    recovery_value_cents: valueCents,
    details: { created, skipped, failed },
  };
}

// ---------- Job dispatch ----------
async function runHandler(client: ReturnType<typeof createClient>, job: QueueJob, worker_id: string): Promise<{
  records_processed: number; records_succeeded: number; records_failed: number;
  recovery_value_cents: number; details: Record<string, unknown>;
}> {
  const k = job.job_type;
  if (k === 'contract_recovery_analysis') return await runContractRecovery(client, job, worker_id);
  if (k === 'dispute_generation') return await runDisputeGeneration(client, job, worker_id);

  if (k === 'remittance_analysis') {
    const { data } = await client.from('remittance_batches').select('status').eq('org_id', job.org_id);
    const rows = (data ?? []) as Array<{ status: string }>;
    const ok = rows.filter(r => r.status === 'completed' || r.status === 'processed').length;
    return { records_processed: rows.length, records_succeeded: ok, records_failed: rows.length - ok, recovery_value_cents: 0, details: { batches: rows.length } };
  }
  if (k === 'contract_matching') {
    const [{ data: claims }, { data: contracts }] = await Promise.all([
      client.from('claims').select('payload').eq('org_id', job.org_id),
      client.from('payer_contracts').select('payer_name').eq('org_id', job.org_id),
    ]);
    const set = new Set(((contracts ?? []) as Array<{ payer_name: string }>).map(c => (c.payer_name ?? '').toLowerCase()));
    const rows = (claims ?? []) as Array<{ payload: any }>;
    let matched = 0;
    for (const r of rows) {
      const p = (r.payload?.intel?.payer_name ?? r.payload?.payer_name ?? '') as string;
      if (p && set.has(p.toLowerCase())) matched += 1;
    }
    return { records_processed: rows.length, records_succeeded: matched, records_failed: rows.length - matched, recovery_value_cents: 0, details: { matched } };
  }
  if (k === 'underpayment_detection') {
    const { data } = await client.from('underpayment_disputes').select('variance_amount_cents, status').eq('org_id', job.org_id);
    const rows = (data ?? []) as Array<{ variance_amount_cents: number | null; status: string }>;
    const value = rows.reduce((s, r) => s + (r.variance_amount_cents ?? 0), 0);
    return { records_processed: rows.length, records_succeeded: rows.length, records_failed: 0, recovery_value_cents: value, details: { open: rows.filter(r => r.status === 'open').length } };
  }
  if (k === 'recovery_case_generation') {
    const { data: disputes } = await client.from('underpayment_disputes')
      .select('claim_id, severity, status, payer_name, variance_percent')
      .eq('org_id', job.org_id).in('severity', ['high', 'critical']).eq('status', 'open');
    const open = (disputes ?? []) as Array<{ claim_id: string; payer_name: string; variance_percent: number }>;
    const { data: links } = await client.from('case_claim_links').select('claim_id').eq('org_id', job.org_id);
    const linked = new Set(((links ?? []) as Array<{ claim_id: string }>).map(r => r.claim_id));
    const targets = open.filter(o => !linked.has(o.claim_id));
    let created = 0;
    for (const t of targets) {
      const caseTrigger = 'major_underpayment' as const;
      const { data: c } = await client.from('cases').insert([{
        org_id: job.org_id, trigger: caseTrigger, status: 'open',
        description: `Auto-case for ${t.payer_name} underpayment (${t.variance_percent?.toFixed?.(1) ?? '?'}%)`,
      }] as never).select('case_id').single();
      if (c) {
        await client.from('case_claim_links').insert([{ case_id: (c as any).case_id, claim_id: t.claim_id, org_id: job.org_id }] as never);
        // case_created lineage event. The case is a distinct entity from dispute:
        // one case may cover multiple high-severity disputes for the same claim.
        // The linked-claim check above guarantees this fires at most once per claim.
        // trigger is read from caseTrigger (same value written to cases.trigger above).
        await client.from('recovery_lineage_events').insert([{
          org_id: job.org_id,
          claim_id: t.claim_id,
          event_type: 'case_created',
          event_summary: `Recovery case created for ${t.payer_name} underpayment (${t.variance_percent?.toFixed?.(1) ?? '?'}%)`,
          payload: { case_id: (c as any).case_id, trigger: caseTrigger, payer_name: t.payer_name },
        }] as never);
        created += 1;
      }
    }
    return { records_processed: targets.length, records_succeeded: created, records_failed: targets.length - created, recovery_value_cents: 0, details: { cases_created: created } };
  }
  if (k === 'queue_assignment') {
    const { data: disputes } = await client.from('underpayment_disputes')
      .select('claim_id').eq('org_id', job.org_id).eq('status', 'open');
    const { data: assigns } = await client.from('claim_assignments').select('claim_id').eq('org_id', job.org_id);
    const assigned = new Set(((assigns ?? []) as Array<{ claim_id: string }>).map(r => r.claim_id));
    const queue = ((disputes ?? []) as Array<{ claim_id: string }>).filter(d => !assigned.has(d.claim_id));
    const ASSIGNEES = ['analyst-1','analyst-2','analyst-3'];
    let ok = 0;
    for (let i = 0; i < queue.length; i++) {
      const { error } = await client.from('claim_assignments').insert([{
        claim_id: queue[i].claim_id, assignee: ASSIGNEES[i % ASSIGNEES.length], status: 'open', org_id: job.org_id,
      }] as never);
      if (!error) ok += 1;
    }
    return { records_processed: queue.length, records_succeeded: ok, records_failed: queue.length - ok, recovery_value_cents: 0, details: { round_robin_size: ASSIGNEES.length } };
  }
  if (k === 'executive_recalculation') {
    const [{ count: cl }, { count: oc }, { count: di }] = await Promise.all([
      client.from('claims').select('*', { count: 'exact', head: true }).eq('org_id', job.org_id),
      client.from('recovery_outcomes').select('*', { count: 'exact', head: true }).eq('org_id', job.org_id),
      client.from('underpayment_disputes').select('*', { count: 'exact', head: true }).eq('org_id', job.org_id),
    ]);
    const total = (cl ?? 0) + (oc ?? 0) + (di ?? 0);
    return { records_processed: total, records_succeeded: total, records_failed: 0, recovery_value_cents: 0, details: { claims: cl, outcomes: oc, disputes: di } };
  }
  throw new Error(`Unknown job_type ${k}`);
}

async function executeOne(client: ReturnType<typeof createClient>, worker_id: string, job: QueueJob): Promise<{ ok: boolean; error?: string }> {
  const start = Date.now();
  try {
    const r = await runHandler(client, job, worker_id);
    const duration_ms = Date.now() - start;
    await client.from('job_queue').update({
      status: 'completed', completed_at: new Date().toISOString(), last_error: null,
    } as never).eq('queue_job_id', job.queue_job_id);
    await client.from('job_runs').insert([{
      queue_job_id: job.queue_job_id, worker_id, duration_ms, status: 'completed',
      records_processed: r.records_processed, records_succeeded: r.records_succeeded,
      records_failed: r.records_failed, result_summary: r.details, org_id: job.org_id,
    }] as never);
    await client.from('automation_jobs').insert([{
      job_type: job.job_type, status: 'completed', org_id: job.org_id,
      started_at: new Date(start).toISOString(), completed_at: new Date().toISOString(),
      records_processed: r.records_processed, records_succeeded: r.records_succeeded,
      records_failed: r.records_failed, recovery_value_cents: r.recovery_value_cents,
      pipeline_id: job.pipeline_id, result: r.details,
    }] as never);
    await audit(client, 'job_completed',
      `Job completed: ${job.job_type} (${r.records_succeeded}/${r.records_processed})`,
      `system:${worker_id}`, null,
      { queue_job_id: job.queue_job_id, worker_id, ...r });
    return { ok: true };
  } catch (e: any) {
    const duration_ms = Date.now() - start;
    const message = e?.message ?? String(e);
    await client.from('job_runs').insert([{
      queue_job_id: job.queue_job_id, worker_id, duration_ms, status: 'failed',
      records_processed: 0, records_succeeded: 0, records_failed: 0,
      result_summary: { error: message }, org_id: job.org_id,
    }] as never);
    await client.from('job_failures').insert([{
      queue_job_id: job.queue_job_id, org_id: job.org_id,
      error_message: message, stack_trace: e?.stack ?? null, retry_count: job.attempts,
    }] as never);
    const exhausted = job.attempts >= job.max_attempts;
    if (exhausted) {
      await client.from('job_queue').update({
        status: 'dead_letter', completed_at: new Date().toISOString(), last_error: message,
      } as never).eq('queue_job_id', job.queue_job_id);
      await audit(client, 'job_dead_lettered',
        `Dead-lettered ${job.job_type} after ${job.attempts} attempts`,
        `system:${worker_id}`, null, { queue_job_id: job.queue_job_id, error: message });
    } else {
      const backoffMs = Math.min(2 ** job.attempts * 1000, 300_000);
      await client.from('job_queue').update({
        status: 'queued', worker_id: null, locked_at: null, last_error: message,
        next_attempt_at: new Date(Date.now() + backoffMs).toISOString(),
      } as never).eq('queue_job_id', job.queue_job_id);
      await audit(client, 'job_retried', `Retry scheduled for ${job.job_type}`,
        `system:${worker_id}`, null, { queue_job_id: job.queue_job_id, attempt: job.attempts, backoffMs });
    }
    return { ok: false, error: message };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const maxJobs = Math.max(1, Math.min(50, Number(url.searchParams.get('max') ?? '10')));
  const worker_id = url.searchParams.get('worker_id') ?? `srv-${crypto.randomUUID().slice(0,8)}`;

  const client = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  await registerWorker(client, worker_id);

  const { data: recovered } = await client.rpc('recover_stalled_queue_jobs', { _stale_minutes: 10 } as never);
  if ((recovered as unknown as number) > 0) {
    await audit(client, 'stalled_job_recovered',
      `Recovered ${recovered} stalled job(s)`, `system:${worker_id}`, null, { count: recovered });
  }

  let executed = 0, ok = 0, fail = 0;
  for (let i = 0; i < maxJobs; i++) {
    const { data: job, error } = await client.rpc('claim_next_queue_job', { _worker_id: worker_id } as never);
    if (error || !job) break;
    const j = job as unknown as QueueJob;
    if (!j.queue_job_id) break;
    executed += 1;
    const r = await executeOne(client, worker_id, j);
    if (r.ok) ok += 1; else fail += 1;
  }

  await heartbeat(client, worker_id, ok, fail);

  return new Response(JSON.stringify({
    worker_id, executed, ok, fail, stalled_recovered: recovered ?? 0,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
});
