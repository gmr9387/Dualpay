/**
 * Phase 22 — Plan Benefits persistence layer.
 * Versioned CRUD for plan_benefits, mirroring contracts.ts. Manually
 * uploaded by staff (no external eligibility/834 feed exists) — the same
 * real-data-source model already used for payer_contracts.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { appendOpsEvent } from '@/lib/ops-events';
import type { PlanBenefitRecord } from '@/types/plan-benefits';
import type { PlanBenefits } from '@/types/claim';

const sb = supabase as ReturnType<typeof createClient>;

export const PLAN_BENEFITS_EVENT = 'clarity-plan-benefits';

export async function listPlanBenefits(): Promise<PlanBenefitRecord[]> {
  const { data, error } = await sb.from('plan_benefits').select('*')
    .order('payer_name', { ascending: true }).order('effective_date', { ascending: false });
  if (error) { console.error('[plan-benefits] list failed', error.message); return []; }
  return (data ?? []) as PlanBenefitRecord[];
}

export async function getPlanBenefit(plan_id: string): Promise<PlanBenefitRecord | null> {
  const { data, error } = await sb.from('plan_benefits').select('*').eq('plan_id', plan_id).maybeSingle();
  if (error) { console.error('[plan-benefits] get failed', error.message); return null; }
  return data as PlanBenefitRecord | null;
}

export async function createPlanBenefit(input: {
  payer_name: string; plan_name: string; version?: string; plan_year: number;
  deductible_individual: number; deductible_family: number;
  oop_max_individual: number; oop_max_family: number;
  coinsurance_rate: number; copay_amount?: number | null;
  cob_policy?: string; covered_services?: PlanBenefitRecord['covered_services'];
  effective_date: string; termination_date?: string | null; uploaded_by?: string;
}): Promise<PlanBenefitRecord | null> {
  // Auto-bump version if a plan with the same payer + name already exists.
  const { data: existing } = await sb.from('plan_benefits').select('plan_version')
    .eq('payer_name', input.payer_name).eq('plan_name', input.plan_name);
  const nextVersion = input.version ?? String(((existing ?? []).length || 0) + 1);

  const row = {
    payer_name: input.payer_name,
    plan_name: input.plan_name,
    plan_version: nextVersion,
    plan_year: input.plan_year,
    deductible_individual: input.deductible_individual,
    deductible_family: input.deductible_family,
    oop_max_individual: input.oop_max_individual,
    oop_max_family: input.oop_max_family,
    coinsurance_rate: input.coinsurance_rate,
    copay_amount: input.copay_amount ?? null,
    cob_policy: input.cob_policy ?? 'standard',
    covered_services: input.covered_services ?? [],
    effective_date: input.effective_date,
    termination_date: input.termination_date ?? null,
    uploaded_by: input.uploaded_by ?? null,
  };
  const { data, error } = await sb.from('plan_benefits').insert([row]).select('*').single();
  if (error || !data) { console.error('[plan-benefits] create failed', error?.message); return null; }
  await appendOpsEvent({
    kind: 'contract_uploaded', // reuse — same "on-file benefit data uploaded" event family
    summary: `Plan benefits uploaded: ${input.payer_name} — ${input.plan_name} v${nextVersion}`,
    payload: { plan_id: data.plan_id, version: nextVersion },
  });
  window.dispatchEvent(new Event(PLAN_BENEFITS_EVENT));
  return data as PlanBenefitRecord;
}

function toKernelPlan(r: PlanBenefitRecord): PlanBenefits {
  return {
    plan_id: r.plan_id,
    plan_version: r.plan_version,
    plan_name: r.plan_name,
    plan_year: r.plan_year,
    deductible_individual: r.deductible_individual,
    deductible_family: r.deductible_family,
    oop_max_individual: r.oop_max_individual,
    oop_max_family: r.oop_max_family,
    coinsurance_rate: r.coinsurance_rate,
    copay_amount: r.copay_amount ?? undefined,
    cob_policy: (r.cob_policy as PlanBenefits['cob_policy']) ?? 'standard',
    covered_services: r.covered_services ?? [],
  };
}

/**
 * Resolves the real, currently-effective plan benefits for a payer — the
 * non-demo replacement for the LIVE_PLAN stub. Returns null (never a
 * zeroed guess) when no admin-entered plan is on file yet for this payer.
 */
export async function loadLivePlan(payer_name: string, service_date?: string | null): Promise<PlanBenefits | null> {
  if (!payer_name) return null;
  const all = await listPlanBenefits();
  const svc = service_date ? new Date(service_date).getTime() : Date.now();
  const active = all
    .filter(p => p.payer_name === payer_name && new Date(p.effective_date).getTime() <= svc
      && (!p.termination_date || new Date(p.termination_date).getTime() >= svc))
    .sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime());
  const record = active[0];
  return record ? toKernelPlan(record) : null;
}
