/**
 * Phase 15 — Contracts persistence layer.
 * Versioned CRUD for payer_contracts + fee_schedules + underpayment_disputes.
 * Never overwrites: new version creates a new contract row.
 */
import { supabase } from '@/integrations/supabase/client';
import { appendOpsEvent } from '@/lib/ops-events';
import { appendLineageEvent } from '@/lib/lineage';
import { withTriggerOrgId } from '@/lib/supabase-helpers';
import type { Database } from '@/integrations/supabase/types';
import type {
  PayerContract, FeeScheduleRow, UnderpaymentDispute,
} from '@/types/contracts';

type DisputeUpdate = Database['public']['Tables']['underpayment_disputes']['Update'];

const sb = supabase;

export const CONTRACT_EVENT = 'clarity-contracts';

export async function listContracts(): Promise<PayerContract[]> {
  const { data, error } = await sb.from('payer_contracts').select('*')
    .order('payer_name', { ascending: true }).order('effective_date', { ascending: false });
  if (error) { console.error('[contracts] list failed', error.message); return []; }
  return (data ?? []) as PayerContract[];
}

export async function getContract(contract_id: string): Promise<PayerContract | null> {
  const { data, error } = await sb.from('payer_contracts').select('*').eq('contract_id', contract_id).maybeSingle();
  if (error) { console.error('[contracts] get failed', error.message); return null; }
  return data as PayerContract | null;
}

/**
 * Builds a real ContractTerms (the shape the local adjudication kernel
 * needs) from the currently-effective payer_contracts/fee_schedules rows
 * for a payer — the real, non-demo replacement for the LIVE_CONTRACT stub.
 *
 * fee_schedule only includes rows whose reimbursement_method is a flat
 * per-procedure amount (fixed_fee/case_rate/per_diem). percent_of_billed
 * and percent_of_medicare rows need the claim's own billed amount at
 * adjudication time to resolve to cents and can't be flattened into a
 * static map here — they're left out rather than guessed, so the kernel's
 * own "no fee schedule match" path applies to those procedures instead of
 * silently pricing them wrong.
 */
export async function loadLiveContract(payer_name: string): Promise<import('@/types/claim').ContractTerms | null> {
  if (!payer_name) return null;
  const contracts = await listContracts();
  const now = Date.now();
  const active = contracts
    .filter(c => c.payer_name === payer_name && new Date(c.effective_date).getTime() <= now
      && (!c.termination_date || new Date(c.termination_date).getTime() >= now))
    .sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime());
  const contract = active[0];
  if (!contract) return null;

  const fees = await listFeeSchedules(contract.contract_id);
  const fee_schedule = new Map<string, number>();
  for (const f of fees) {
    if (f.reimbursement_method === 'fixed_fee' || f.reimbursement_method === 'case_rate' || f.reimbursement_method === 'per_diem') {
      fee_schedule.set(f.procedure_code, f.contracted_amount_cents);
    }
  }

  return {
    contract_id: contract.contract_id,
    contract_version: contract.version,
    provider_npi: '',
    effective_date: contract.effective_date,
    term_date: contract.termination_date ?? '',
    fee_schedule_id: fees[0]?.fee_schedule_id ?? '',
    fee_schedule,
    reimbursement_method: 'fee_schedule',
  };
}

export async function listFeeSchedules(contract_id: string): Promise<FeeScheduleRow[]> {
  const { data, error } = await sb.from('fee_schedules').select('*').eq('contract_id', contract_id)
    .order('procedure_code', { ascending: true });
  if (error) { console.error('[contracts] fees failed', error.message); return []; }
  return (data ?? []) as FeeScheduleRow[];
}

export async function createContract(input: {
  payer_name: string; contract_name: string; version?: string;
  effective_date: string; termination_date?: string | null;
  contract_type?: string; uploaded_by?: string;
}): Promise<PayerContract | null> {
  // Auto-bump version if a contract with same payer + name already exists.
  const { data: existing } = await sb.from('payer_contracts').select('version')
    .eq('payer_name', input.payer_name).eq('contract_name', input.contract_name);
  const nextVersion = input.version ?? String(((existing ?? []).length || 0) + 1);

  const row = {
    payer_name: input.payer_name,
    contract_name: input.contract_name,
    version: nextVersion,
    effective_date: input.effective_date,
    termination_date: input.termination_date ?? null,
    contract_type: input.contract_type ?? 'commercial',
    uploaded_by: input.uploaded_by ?? null,
  };
  const { data, error } = await sb.from('payer_contracts').insert(withTriggerOrgId([row])).select('*').single();
  if (error || !data) { console.error('[contracts] create failed', error?.message); return null; }
  await appendOpsEvent({
    kind: 'contract_uploaded',
    summary: `Contract uploaded: ${input.payer_name} — ${input.contract_name} v${nextVersion}`,
    payload: { contract_id: data.contract_id, version: nextVersion },
  });
  window.dispatchEvent(new Event(CONTRACT_EVENT));
  return data as PayerContract;
}

export async function addFeeScheduleRows(
  contract_id: string,
  rows: Array<Omit<FeeScheduleRow, 'fee_schedule_id' | 'org_id' | 'contract_id'>>,
): Promise<number> {
  if (!rows.length) return 0;
  const payload = rows.map(r => ({ ...r, contract_id }));
  const { error, data } = await sb.from('fee_schedules').insert(withTriggerOrgId(payload)).select('fee_schedule_id');
  if (error) { console.error('[contracts] fees insert failed', error.message); return 0; }
  await appendOpsEvent({
    kind: 'contract_version_created',
    summary: `Fee schedule loaded: ${rows.length} lines for contract ${contract_id}`,
    payload: { contract_id, row_count: rows.length },
  });
  return (data ?? []).length;
}

// ---------- Disputes ----------

export async function listDisputes(): Promise<UnderpaymentDispute[]> {
  const { data, error } = await sb.from('underpayment_disputes').select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('[disputes] list failed', error.message); return []; }
  return (data ?? []) as UnderpaymentDispute[];
}

function makeDedupeKey(input: {
  claim_id: string; contract_id?: string | null; variance_amount_cents: number; service_date?: string | null;
}): string {
  // Mirrors the backfill formula in the dedupe_key migration exactly.
  return [input.claim_id, input.contract_id ?? 'none', String(input.variance_amount_cents), input.service_date ?? 'none'].join('|');
}

export async function createDispute(
  input: Omit<UnderpaymentDispute, 'dispute_id' | 'org_id' | 'created_at' | 'updated_at' | 'dedupe_key' | 'fee_percent_bps' | 'assessed_fee_cents' | 'client_response' | 'client_response_at' | 'client_response_notes' | 'report_generated_at' | 'report_sent_at'>,
  opts?: { auto?: boolean },
): Promise<UnderpaymentDispute | null> {
  const dedupe_key = makeDedupeKey(input);

  // A remittance re-import (or a re-run of the recovery sweep) must not
  // create a second dispute for the same claim/contract/variance/service-date.
  const { data: existing } = await sb.from('underpayment_disputes')
    .select('*').eq('claim_id', input.claim_id).eq('dedupe_key', dedupe_key).maybeSingle();
  if (existing) {
    if (opts?.auto) {
      await appendOpsEvent({
        kind: 'dispute_duplicate_skipped',
        claim_id: input.claim_id,
        summary: `Underpayment dispute already on file for ${input.claim_id} — skipped`,
        payload: { dispute_id: (existing as UnderpaymentDispute).dispute_id, dedupe_key },
      });
    }
    return existing as UnderpaymentDispute;
  }

  const row = { ...input, client_response: 'pending', dedupe_key };
  const { data, error } = await sb.from('underpayment_disputes').insert(withTriggerOrgId([row])).select('*').single();
  if (error || !data) { console.error('[disputes] create failed', error?.message); return null; }
  await appendOpsEvent({
    kind: opts?.auto ? 'dispute_auto_created' : 'dispute_created',
    claim_id: input.claim_id,
    summary: `Underpayment dispute ${opts?.auto ? 'auto-detected' : 'opened'}: ${input.payer_name} variance ${(input.variance_percent).toFixed(1)}%`,
    payload: {
      dispute_id: data.dispute_id,
      variance_cents: input.variance_amount_cents,
      severity: input.severity,
    },
  });
  // Lineage event — dispute_created step in recovery chain. org_id is not
  // a param here: recovery_lineage_events also populates it via trigger.
  await appendLineageEvent({
    claim_id: input.claim_id ?? null,
    dispute_id: data.dispute_id,
    event_type: 'dispute_created',
    event_summary: `Dispute opened: ${input.payer_name} variance ${(input.variance_percent).toFixed(1)}%`,
    payload: { dispute_id: data.dispute_id, variance_cents: input.variance_amount_cents, severity: input.severity },
  });
  window.dispatchEvent(new Event(CONTRACT_EVENT));
  return data as UnderpaymentDispute;
}

/**
 * Matches a claim line to the real, currently-effective fee schedule row for
 * its payer + procedure code, so retrospective underpayment detection runs
 * against real contract terms instead of a placeholder.
 */
export async function findFeeScheduleForClaim(
  payer_name: string,
  procedure_code: string,
  service_date?: string | null,
): Promise<{ fee: FeeScheduleRow; contract_id: string } | null> {
  if (!payer_name || !procedure_code) return null;
  const { data, error } = await sb
    .from('fee_schedules')
    .select('*, payer_contracts!inner(contract_id,payer_name,effective_date,termination_date)')
    .eq('procedure_code', procedure_code)
    .eq('payer_contracts.payer_name', payer_name);
  if (error || !data?.length) return null;

  type Row = FeeScheduleRow & { payer_contracts: { contract_id: string; effective_date: string; termination_date: string | null } };
  const svc = service_date ? new Date(service_date).getTime() : Date.now();
  const best = (data as unknown as Row[])
    .filter(row => {
      const eff = new Date(row.payer_contracts.effective_date).getTime();
      const term = row.payer_contracts.termination_date ? new Date(row.payer_contracts.termination_date).getTime() : null;
      return eff <= svc && (term === null || term >= svc);
    })
    .sort((a, b) => new Date(b.payer_contracts.effective_date).getTime() - new Date(a.payer_contracts.effective_date).getTime())[0];
  if (!best) return null;
  return { fee: best, contract_id: best.payer_contracts.contract_id };
}

export async function updateDisputeStatus(
  dispute_id: string,
  status: string,
  opts?: { feePercentBps?: number },
): Promise<void> {
  const patch: DisputeUpdate = { status };

  // Contingency fee: only ever assessed on an actual recovery, computed off
  // the real variance this dispute recovered. No fee percent configured (0)
  // means no fee is assessed — never a silently invented number.
  if (status === 'recovered' && opts?.feePercentBps) {
    const { data: existing } = await sb.from('underpayment_disputes')
      .select('variance_amount_cents').eq('dispute_id', dispute_id).maybeSingle();
    const varianceCents = (existing as { variance_amount_cents?: number } | null)?.variance_amount_cents ?? 0;
    patch.fee_percent_bps = opts.feePercentBps;
    patch.assessed_fee_cents = Math.round((varianceCents * opts.feePercentBps) / 10000);
  }

  const { error } = await sb.from('underpayment_disputes').update(patch).eq('dispute_id', dispute_id);
  if (error) { console.error('[disputes] update failed', error.message); return; }

  if (patch.assessed_fee_cents) {
    await appendOpsEvent({
      kind: 'fee_assessed',
      summary: `Recovery fee assessed: ${(opts!.feePercentBps! / 100).toFixed(1)}% of recovered variance`,
      payload: { dispute_id, assessed_fee_cents: patch.assessed_fee_cents, fee_percent_bps: opts!.feePercentBps },
    });
  }
  window.dispatchEvent(new Event(CONTRACT_EVENT));
}

/** Records the client's (provider org's) decision after reviewing a recovery report. */
export async function recordClientResponse(
  dispute_id: string,
  response: 'approved_pursue' | 'declined' | 'handling_internally',
  notes?: string,
): Promise<void> {
  const { error } = await sb.from('underpayment_disputes').update({
    client_response: response,
    client_response_at: new Date().toISOString(),
    client_response_notes: notes ?? null,
  }).eq('dispute_id', dispute_id);
  if (error) { console.error('[disputes] client response failed', error.message); return; }
  await appendOpsEvent({
    kind: 'client_response_recorded',
    summary: `Client response recorded: ${response.replace(/_/g, ' ')}`,
    payload: { dispute_id, response, notes: notes ?? null },
  });
  window.dispatchEvent(new Event(CONTRACT_EVENT));
}

export async function markReportGenerated(dispute_id: string): Promise<void> {
  const { error } = await sb.from('underpayment_disputes')
    .update({ report_generated_at: new Date().toISOString() }).eq('dispute_id', dispute_id);
  if (error) { console.error('[disputes] mark report generated failed', error.message); return; }
  await appendOpsEvent({ kind: 'recovery_report_generated', summary: 'Recovery report generated', payload: { dispute_id } });
  window.dispatchEvent(new Event(CONTRACT_EVENT));
}

export async function markReportSent(dispute_id: string): Promise<void> {
  const { error } = await sb.from('underpayment_disputes')
    .update({ report_sent_at: new Date().toISOString() }).eq('dispute_id', dispute_id);
  if (error) { console.error('[disputes] mark report sent failed', error.message); return; }
  await appendOpsEvent({ kind: 'recovery_report_sent', summary: 'Recovery report marked sent to client', payload: { dispute_id } });
  window.dispatchEvent(new Event(CONTRACT_EVENT));
}
