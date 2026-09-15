/**
 * Client for the nucleus-weaver-score Edge Function (supabase/functions/
 * nucleus-weaver-score/) -- the server-side proxy that holds nucleus's
 * API key and forwards a scoring request to valtaris-nucleus's real,
 * admin-configurable Weaver rules engine.
 *
 * This is a new, additive capability: calling it does not change what
 * automation-rules.ts / next-action.ts do today (they still run this
 * repo's own local heuristics). Wiring a call site to use this instead
 * is a separate, deliberate decision -- same rationale as
 * nucleus-adjudication-client.ts's header.
 *
 * Returns `configured: false` (not a thrown error) when the Edge
 * Function reports NUCLEUS_API_URL/NUCLEUS_API_KEY aren't set yet, so
 * callers can distinguish "not wired up" from "nucleus said no."
 */
import { supabase } from '@/integrations/supabase/client';

export type WeaverScoreStage = 'opportunity' | 'recommendation';

export interface NucleusWeaverScoreRequest {
  stage: WeaverScoreStage;
  claim_id?: string;
  facts?: Record<string, unknown>;
}

export interface NucleusOpportunityScoreResult {
  configured: true;
  stage: 'opportunity';
  score: number;
  fired_rules: string[];
  claim_id: string | null;
  timestamp: string;
}

export interface NucleusRecommendationScoreResult {
  configured: true;
  stage: 'recommendation';
  confidence: number;
  action: 'approve' | 'review';
  fired_rules: string[];
  claim_id: string | null;
  timestamp: string;
}

export type NucleusWeaverScoreResult = NucleusOpportunityScoreResult | NucleusRecommendationScoreResult;

export interface NucleusWeaverScoreNotConfigured {
  configured: false;
  error: string;
}

export async function scoreViaNucleusWeaver(
  request: NucleusWeaverScoreRequest,
): Promise<NucleusWeaverScoreResult | NucleusWeaverScoreNotConfigured> {
  const { data, error } = await supabase.functions.invoke('nucleus-weaver-score', {
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
    throw new Error(`Nucleus Weaver scoring failed: ${error.message}`);
  }

  return { configured: true, ...(data as Omit<NucleusWeaverScoreResult, 'configured'>) };
}
