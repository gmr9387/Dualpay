// Phase 22 — Plan Benefits types (the DB-row shape; distinct from the
// in-memory PlanBenefits the adjudication kernel consumes — see
// lib/plan-benefits.ts's toKernelPlan for the mapping).
import type { COBPolicyType, CoveredService } from '@/types/claim';

export interface PlanBenefitRecord {
  plan_id: string;
  org_id: string;
  payer_name: string;
  plan_name: string;
  plan_version: string;
  plan_year: number;
  deductible_individual: number; // cents
  deductible_family: number; // cents
  oop_max_individual: number; // cents
  oop_max_family: number; // cents
  coinsurance_rate: number; // 0-1
  copay_amount?: number | null; // cents
  cob_policy: COBPolicyType | string;
  covered_services: CoveredService[];
  effective_date: string;
  termination_date?: string | null;
  uploaded_by?: string | null;
  uploaded_at?: string;
  created_at?: string;
  updated_at?: string;
}
