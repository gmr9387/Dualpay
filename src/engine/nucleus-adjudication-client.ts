/**
 * Client for the nucleus-adjudicate Edge Function (supabase/functions/
 * nucleus-adjudicate/) -- the server-side proxy that holds nucleus's
 * API key and forwards a claim to valtaris-nucleus's real, contract-
 * enforced adjudication engine.
 *
 * This is a new, additive capability: calling it does not change what
 * ClaimsWorkbench.tsx / Index.tsx / case-management.ts do today (they
 * still call executeAdjudicationWithReplay() against this repo's own
 * local engine). Wiring a call site to use this instead is a separate,
 * deliberate decision -- it changes a live financial-calculation path
 * and deserves its own review, not a change bundled in here.
 *
 * Returns `configured: false` (not a thrown error) when the Edge
 * Function reports NUCLEUS_API_URL/NUCLEUS_API_KEY aren't set yet, so
 * callers can distinguish "not wired up" from "nucleus said no."
 */
import { supabase } from '@/integrations/supabase/client';

export interface NucleusAdjudicationRequest {
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

export interface NucleusAdjudicationResult {
  configured: true;
  decision: 'allow' | 'deny' | 'no_contract_on_file';
  reason: string;
  adjudication?: {
    status: string;
    allowed: number;
    plan_paid: number;
    member_responsibility: number;
    deductible_applied: number;
    coinsurance: number;
  };
  risk_tier: 'low' | 'medium' | 'high' | 'critical';
  used_empty_accumulators?: boolean;
  contract_id: string | null;
  plan_id: string | null;
  timestamp: string;
}

export interface NucleusAdjudicationNotConfigured {
  configured: false;
  error: string;
}

export async function adjudicateViaNucleus(
  request: NucleusAdjudicationRequest,
): Promise<NucleusAdjudicationResult | NucleusAdjudicationNotConfigured> {
  const { data, error } = await supabase.functions.invoke('nucleus-adjudicate', {
    body: request,
  });

  if (error) {
    // The proxy returns HTTP 501 with a clear message when nucleus's
    // secrets aren't configured yet -- surface that distinctly rather
    // than as a generic failure.
    const context = (error as { context?: { status?: number } }).context;
    if (context?.status === 501) {
      return { configured: false, error: error.message };
    }
    throw new Error(`Nucleus adjudication failed: ${error.message}`);
  }

  return { configured: true, ...(data as Omit<NucleusAdjudicationResult, 'configured'>) };
}
