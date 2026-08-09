/**
 * Phase 15 — Contracts persistence layer.
 * Versioned CRUD for payer_contracts + fee_schedules + underpayment_disputes.
 * Never overwrites: new version creates a new contract row.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { appendOpsEvent } from '@/lib/ops-events';
import { appendLineageEvent } from '@/lib/lineage';
import type {
  PayerContract, FeeScheduleRow, UnderpaymentDispute,
} from '@/types/contracts';

const sb = supabase as ReturnType<typeof createClient>;

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
  const { data, error } = await sb.from('payer_contracts').insert([row]).select('*').single();
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
  const { error, data } = await sb.from('fee_schedules').insert(payload).select('fee_schedule_id');
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

export async function createDispute(
  input: Omit<UnderpaymentDispute, 'dispute_id' | 'org_id' | 'created_at' | 'updated_at'>,
): Promise<UnderpaymentDispute | null> {
  const { data, error } = await sb.from('underpayment_disputes').insert([input]).select('*').single();
  if (error || !data) { console.error('[disputes] create failed', error?.message); return null; }
  await appendOpsEvent({
    kind: 'dispute_created',
    claim_id: input.claim_id,
    summary: `Underpayment dispute opened: ${input.payer_name} variance ${(input.variance_percent).toFixed(1)}%`,
    payload: {
      dispute_id: data.dispute_id,
      variance_cents: input.variance_amount_cents,
      severity: input.severity,
    },
  });
  // Lineage event — dispute_created step in recovery chain.
  await appendLineageEvent({
    org_id: (data as UnderpaymentDispute).org_id ?? null,
    claim_id: input.claim_id ?? null,
    event_type: 'dispute_created',
    event_summary: `Dispute opened: ${input.payer_name} variance ${(input.variance_percent).toFixed(1)}%`,
    payload: { dispute_id: data.dispute_id, variance_cents: input.variance_amount_cents, severity: input.severity },
  });
  return data as UnderpaymentDispute;
}

export async function updateDisputeStatus(dispute_id: string, status: string): Promise<void> {
  const { error } = await sb.from('underpayment_disputes')
    .update({ status }).eq('dispute_id', dispute_id);
  if (error) console.error('[disputes] update failed', error.message);
}
