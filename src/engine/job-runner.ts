/**
 * Phase 16 — Job Runner.
 *
 * Executes deterministic recovery jobs.  Each handler reads from existing
 * persisted state (claims, remittances, contracts, disputes, outcomes) and
 * reuses authoritative engines.  No fabricated data.
 *
 * Job kinds:
 *   - remittance_analysis
 *   - contract_matching
 *   - underpayment_detection
 *   - dispute_generation
 *   - recovery_case_generation
 *   - queue_assignment
 *   - executive_recalculation
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { startJob, completeJob, failJob } from '@/lib/automation';
import { listContracts, listDisputes, createDispute } from '@/lib/contracts';
import { setAssignment } from '@/lib/assignments';
import { autoCreateCase } from './auto-case-generator';
import { evaluateRules } from './automation-rules';
import type { JobType, JobRunResult, AutomationJob } from '@/types/automation';

const sb = supabase as ReturnType<typeof createClient>;

export interface JobContext {
  pipeline_id?: string;
  parent_job_id?: string;
  config?: Record<string, unknown>;
}

type Handler = (ctx: JobContext) => Promise<JobRunResult>;

// ---------- Handlers ----------

const remittance_analysis: Handler = async () => {
  const { data } = await sb.from('remittance_batches').select('batch_id, status, total_paid_cents');
  const batches = (data ?? []) as Array<{ batch_id: string; status: string; total_paid_cents: number | null }>;
  const processed = batches.length;
  const succeeded = batches.filter(b => b.status === 'completed' || b.status === 'processed').length;
  return {
    records_processed: processed,
    records_succeeded: succeeded,
    records_failed: processed - succeeded,
    details: { batches: processed },
  };
};

const contract_matching: Handler = async () => {
  const { data: claims } = await sb.from('claims').select('claim_id, payer_name');
  const contracts = await listContracts();
  const payers = new Set(contracts.map(c => (c.payer_name ?? '').toLowerCase()));
  const rows = (claims ?? []) as Array<{ claim_id: string; payer_name: string | null }>;
  let matched = 0;
  for (const c of rows) {
    if (c.payer_name && payers.has(c.payer_name.toLowerCase())) matched += 1;
  }
  return {
    records_processed: rows.length,
    records_succeeded: matched,
    records_failed: rows.length - matched,
    details: { matched, contracts: contracts.length },
  };
};

const underpayment_detection: Handler = async () => {
  // Use existing persisted disputes as the truth of detected underpayments.
  const disputes = await listDisputes();
  const valueCents = disputes.reduce((s, d) => s + (d.variance_amount_cents ?? 0), 0);
  return {
    records_processed: disputes.length,
    records_succeeded: disputes.length,
    records_failed: 0,
    recovery_value_cents: valueCents,
    details: { open_disputes: disputes.filter(d => d.status === 'open').length },
  };
};

const dispute_generation: Handler = async (ctx) => {
  // Auto-mode: read any underpayment_disputes that don't have an assignment, and
  // route through automation rules.  This handler is idempotent: rules decide
  // whether to act, and createDispute is only called for newly surfaced cases
  // via supplied config.candidates (when invoked from a pipeline).
  const candidates = (ctx.config?.candidates as Array<{
    claim_id: string; payer_name: string; variance_amount_cents: number;
    expected_amount_cents: number; allowed_amount_cents: number; paid_amount_cents: number;
    severity: string; variance_percent: number; explanation: string;
    contract_id?: string | null; procedure_code?: string | null;
  }> | undefined) ?? [];

  let succeeded = 0; let failed = 0; let valueCents = 0;
  for (const c of candidates) {
    try {
      const created = await createDispute({
        claim_id: c.claim_id,
        contract_id: c.contract_id ?? null,
        payer_name: c.payer_name,
        procedure_code: c.procedure_code ?? null,
        expected_amount_cents: c.expected_amount_cents,
        allowed_amount_cents: c.allowed_amount_cents,
        paid_amount_cents: c.paid_amount_cents,
        variance_amount_cents: c.variance_amount_cents,
        variance_percent: c.variance_percent,
        severity: c.severity as never,
        status: 'open',
        explanation: c.explanation,
      });
      if (created) {
        succeeded += 1;
        valueCents += c.variance_amount_cents;
        await evaluateRules({
          claim_id: c.claim_id,
          payer_name: c.payer_name,
          variance_cents: c.variance_amount_cents,
        });
      } else { failed += 1; }
    } catch { failed += 1; }
  }
  return {
    records_processed: candidates.length,
    records_succeeded: succeeded,
    records_failed: failed,
    recovery_value_cents: valueCents,
    details: { generated: succeeded },
  };
};

const recovery_case_generation: Handler = async () => {
  // Auto-create cases for high-severity open disputes with no linked case yet.
  const disputes = await listDisputes();
  const open = disputes.filter(d => d.status === 'open' && (d.severity === 'high' || d.severity === 'critical'));
  const { data: existingLinks } = await sb.from('case_claim_links').select('claim_id');
  const linkedClaims = new Set(((existingLinks ?? []) as Array<{ claim_id: string }>).map(r => r.claim_id));

  let succeeded = 0; let failed = 0;
  for (const d of open) {
    if (linkedClaims.has(d.claim_id)) continue;
    const res = await autoCreateCase({
      claim_id: d.claim_id,
      trigger: 'major_underpayment',
      description: `Auto-case for ${d.payer_name} underpayment (${d.variance_percent.toFixed(1)}%)`,
    });
    if (res) succeeded += 1; else failed += 1;
  }
  return {
    records_processed: open.length,
    records_succeeded: succeeded,
    records_failed: failed,
    details: { cases_created: succeeded },
  };
};

const queue_assignment: Handler = async () => {
  // Revenue-readiness fix #4: round-robin over REAL org members
  // (UUIDs from organization_members) — no more hardcoded names.
  const disputes = await listDisputes();
  const open = disputes.filter(d => d.status === 'open');
  const { data: assigns } = await sb.from('claim_assignments').select('claim_id');
  const assigned = new Set(((assigns ?? []) as Array<{ claim_id: string }>).map(r => r.claim_id));
  const queue = open.filter(d => !assigned.has(d.claim_id));

  const { getCurrentOrgId } = await import('@/lib/current-org');
  const orgId = await getCurrentOrgId();
  let members: string[] = [];
  if (orgId) {
    const { loadOrgAssignees } = await import('@/lib/assignments');
    const list = await loadOrgAssignees(orgId);
    members = list.map(m => m.user_id);
  }

  if (members.length === 0) {
    return {
      records_processed: queue.length,
      records_succeeded: 0,
      records_failed: 0,
      details: { skipped: 'no_org_members' },
    };
  }

  let succeeded = 0; let failed = 0;
  for (let i = 0; i < queue.length; i++) {
    const assignee = members[i % members.length];
    const r = await setAssignment(queue[i].claim_id, { assignee, status: 'open' });
    if (r) succeeded += 1; else failed += 1;
  }
  return {
    records_processed: queue.length,
    records_succeeded: succeeded,
    records_failed: failed,
    details: { round_robin_size: members.length },
  };
};

const executive_recalculation: Handler = async () => {
  // Touch counts; executive dashboards recompute on read.
  const [{ count: claimCount }, { count: outcomeCount }, { count: disputeCount }] = await Promise.all([
    sb.from('claims').select('*', { count: 'exact', head: true }),
    sb.from('recovery_outcomes').select('*', { count: 'exact', head: true }),
    sb.from('underpayment_disputes').select('*', { count: 'exact', head: true }),
  ]);
  return {
    records_processed: (claimCount ?? 0) + (outcomeCount ?? 0) + (disputeCount ?? 0),
    records_succeeded: (claimCount ?? 0) + (outcomeCount ?? 0) + (disputeCount ?? 0),
    records_failed: 0,
    details: { claims: claimCount, outcomes: outcomeCount, disputes: disputeCount },
  };
};

/**
 * Phase 19 — contract_recovery_analysis runs server-side in the worker
 * dispatcher edge function. The foreground stub just returns zero counts so
 * synchronous browser-driven invocations are idempotent no-ops; real work is
 * performed when the same job_type is claimed off `job_queue`.
 */
const contract_recovery_analysis: Handler = async () => ({
  records_processed: 0,
  records_succeeded: 0,
  records_failed: 0,
  details: { note: 'contract_recovery_analysis executes server-side via worker-dispatcher' },
});

const HANDLERS: Record<Exclude<JobType, 'pipeline'>, Handler> = {
  remittance_analysis,
  contract_matching,
  underpayment_detection,
  dispute_generation,
  recovery_case_generation,
  queue_assignment,
  executive_recalculation,
  contract_recovery_analysis,
};

// ---------- Public API ----------

export async function runJob(
  job_type: Exclude<JobType, 'pipeline'>,
  ctx: JobContext = {},
): Promise<AutomationJob | null> {
  const job = await startJob(job_type, ctx);
  if (!job) return null;
  try {
    const result = await HANDLERS[job_type](ctx);
    return await completeJob(job.job_id, result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await failJob(job.job_id, msg);
    return null;
  }
}

export const JOB_TYPES: Array<Exclude<JobType, 'pipeline'>> = [
  'remittance_analysis',
  'contract_matching',
  'underpayment_detection',
  'dispute_generation',
  'recovery_case_generation',
  'queue_assignment',
  'executive_recalculation',
  'contract_recovery_analysis',
];
