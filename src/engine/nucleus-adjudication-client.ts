/**
 * Client for the nucleus-adjudicate Edge Function (supabase/functions/
 * nucleus-adjudicate/) -- the server-side proxy that holds nucleus's
 * API key and forwards a claim to valtaris-nucleus's real, contract-
 * enforced adjudication engine.
 *
 * Two request shapes to nucleus's real adjudicate-claim endpoint:
 *
 * 1. adjudicateViaNucleus() -- the original single-line "gate" request
 *    (nucleus resolves contract/plan itself, from ITS OWN separate
 *    contract database). Kept for any caller still using it as a
 *    pre-check; NOT what real claim adjudication uses (see #2).
 *
 * 2. adjudicateClaimViaNucleus() -- the real calculation path. Nucleus's
 *    own payer_contracts/plan_benefits/member_accumulators tables hold
 *    only nucleus's own test data, never DualPay's real customer
 *    contracts -- so #1 can never be a safe source of truth for actual
 *    claim math. This sends DualPay's own already-resolved, already-
 *    correct contract/plan/accumulators/lines directly (the "resolved"
 *    request mode adjudicate-claim/index.ts added for this), and gets
 *    back the full computed run+trace. Nucleus becomes a pure remote
 *    calculation service for data DualPay already owns and resolves
 *    correctly -- not a second, disconnected data source.
 */
import { supabase } from '@/integrations/supabase/client';
import type {
  Claim,
  MemberAccumulators,
  ContractTerms,
  PlanBenefits,
  PriorPayerOutcome,
  AdjudicationRun,
  SessionAccumulator,
} from '@/types/claim';
import type { TraceObject } from '@/types/trace';

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

/** Wire shape of a resolved-mode response's `run` field: final_accumulator
 * .benefit_limits_remaining travels as a plain object (JSON has no Map),
 * converted back to a real Map by adjudicateClaimViaNucleus below. */
type WireAdjudicationRun = Omit<AdjudicationRun, 'final_accumulator'> & {
  final_accumulator: Omit<SessionAccumulator, 'benefit_limits_remaining'> & {
    benefit_limits_remaining: Record<string, number>;
  };
};

interface ResolvedAdjudicationResponse {
  decision: 'allow' | 'deny' | 'error';
  reason?: string;
  error?: string;
  replayed?: boolean;
  run?: WireAdjudicationRun;
  trace?: TraceObject;
  timestamp: string;
}

export interface NucleusResolvedAdjudicationResult {
  run: AdjudicationRun;
  trace: TraceObject;
  replayed: boolean;
}

/**
 * The real calculation call: sends DualPay's own already-resolved
 * contract/plan/accumulators/claim lines to nucleus's adjudicate-claim
 * endpoint ("resolved" mode) and returns the full computed run+trace.
 *
 * options.idempotencyKey should be a real content fingerprint (e.g.
 * buildTraceFingerprint()'s output) -- nucleus caches by this key so a
 * network-level retry of the exact same request returns the cached
 * result instead of recomputing, and also threads it through as the
 * kernel's own traceFingerprint so the returned trace carries the
 * real fingerprint rather than a generic placeholder. This is a
 * second, defense-in-depth idempotency layer; the primary guard
 * remains DualPay's own fingerprint-based replay store, which already
 * prevents a duplicate *request* from ever being sent (see
 * adjudication-orchestrator.ts). runId/timestamp/snapshotRef/traceId
 * are the same deterministic identifiers the orchestrator already
 * computes -- passed through so the run/trace nucleus returns (and
 * this repo then persists) carry DualPay's own real IDs, not
 * nucleus's internal fallback ones.
 *
 * Throws on any failure -- kill-switch-active, a network error, or a
 * malformed response -- rather than silently returning a fallback
 * value. Nucleus is now the sole source of truth for this math; a
 * caller that can't reach it should surface that clearly (the claim
 * stays un-adjudicated) rather than guess.
 */
export async function adjudicateClaimViaNucleus(
  claim: Claim,
  accumulators: MemberAccumulators,
  contract: ContractTerms,
  plan: PlanBenefits,
  priorOutcomes: PriorPayerOutcome[],
  options: {
    idempotencyKey: string;
    runId?: string;
    timestamp?: string;
    snapshotRef?: string;
    traceId?: string;
  },
): Promise<NucleusResolvedAdjudicationResult> {
  const wireContract = {
    ...contract,
    fee_schedule: Object.fromEntries(contract.fee_schedule),
  };

  const { data, error } = await supabase.functions.invoke('nucleus-adjudicate', {
    body: {
      mode: 'resolved',
      claim_id: claim.claim_id,
      lines: claim.lines,
      accumulators,
      contract: wireContract,
      plan,
      prior_outcomes: priorOutcomes,
      idempotency_key: options.idempotencyKey,
      run_id: options.runId,
      timestamp: options.timestamp,
      snapshot_ref: options.snapshotRef,
      trace_id: options.traceId,
    },
  });

  if (error) {
    throw new Error(`Nucleus adjudication failed: ${error.message}`);
  }

  const body = data as ResolvedAdjudicationResponse;
  if (body.decision !== 'allow' || !body.run || !body.trace) {
    throw new Error(
      `Nucleus adjudication did not return a computed run: ${body.error ?? body.reason ?? body.decision}`,
    );
  }

  const run: AdjudicationRun = {
    ...body.run,
    final_accumulator: {
      ...body.run.final_accumulator,
      benefit_limits_remaining: new Map(Object.entries(body.run.final_accumulator.benefit_limits_remaining)),
    },
  };

  return { run, trace: body.trace, replayed: body.replayed ?? false };
}
