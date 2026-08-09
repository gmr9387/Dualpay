/**
 * DualPay Calculation Engine — Pure Functions
 *
 * Deterministic, traceable adjudication kernel.
 */

import type {
  ClaimLine,
  MemberAccumulators,
  ContractTerms,
  PlanBenefits,
  PriorPayerOutcome,
  AdjudicationLineResult,
  AdjudicationRun,
  SessionAccumulator,
  AdjustmentDetail,
  COBAllocation,
  CoveredService,
} from '@/types/claim';
import type { TraceObject, MathStep, RuleFiring } from '@/types/trace';
import { buildTrace, createRuleFiring, createMathStep } from './trace-builder';
import { calculateCOBAllocation } from './cob-rules';

const CALC_POLICY_VERSION = '1.0.0';

let idCounter = 0;

export function generateId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${String(idCounter).padStart(6, '0')}`;
}

export function resetIdCounter(): void {
  idCounter = 0;
}

export interface AdjudicationOptions {
  runId?: string;
  timestamp?: string;
  traceFingerprint?: string;
  snapshotRef?: string;
  traceId?: string;
}

interface BenefitLimitContext {
  service: CoveredService;
  category: string;
  unit: 'dollars' | 'visits' | 'days';
  remaining: number;
  rawAllowed: number;
  allowed: number;
  consumed: number;
  adjustment: number;
  exhausted: boolean;
  partial: boolean;
}

export function sortLines(lines: ClaimLine[]): ClaimLine[] {
  return [...lines].sort((a, b) => {
    const dateComp = a.service_date.localeCompare(b.service_date);
    if (dateComp !== 0) return dateComp;
    return a.claim_line_number - b.claim_line_number;
  });
}

export function initSessionAccumulator(accumulators: MemberAccumulators): SessionAccumulator {
  return {
    deductible_remaining: Math.max(
      0,
      accumulators.individual_deductible_max - accumulators.individual_deductible_used,
    ),
    oop_remaining: Math.max(
      0,
      accumulators.individual_oop_max - accumulators.individual_oop_used,
    ),
    benefit_limits_remaining: new Map(
      accumulators.benefit_limits.map((bl) => [
        bl.benefit_category,
        Math.max(0, bl.max - bl.used),
      ]),
    ),
    lines_processed: [],
  };
}

function getFeeScheduleAmount(
  feeSchedule: ContractTerms['fee_schedule'],
  procedureCode: string,
): number | undefined {
  if (feeSchedule instanceof Map) {
    return feeSchedule.get(procedureCode);
  }

  const value = (feeSchedule as unknown as Record<string, number | undefined>)[procedureCode];
  return typeof value === 'number' ? value : undefined;
}

export function calculateAllowed(line: ClaimLine, contract: ContractTerms): number {
  if (contract.reimbursement_method === 'fee_schedule') {
    const scheduled = getFeeScheduleAmount(contract.fee_schedule, line.procedure_code);

    if (scheduled !== undefined) {
      return Math.min(line.billed_amount, scheduled * line.units);
    }

    return 0;
  }

  if (contract.reimbursement_method === 'percent_of_billed') {
    return Math.round(line.billed_amount * (contract.percent_of_billed ?? 1));
  }

  return line.billed_amount;
}

export function roundCents(amount: number): number {
  return Math.round(amount);
}

function findCoveredService(
  line: ClaimLine,
  plan: PlanBenefits,
): CoveredService | undefined {
  return plan.covered_services.find((service) =>
    service.procedure_codes?.includes(line.procedure_code),
  );
}

function applyBenefitLimit(
  line: ClaimLine,
  rawAllowed: number,
  plan: PlanBenefits,
  sessionAcc: SessionAccumulator,
): BenefitLimitContext | null {
  const service = findCoveredService(line, plan);

  if (!service?.benefit_limit) return null;
  if (rawAllowed <= 0) {
  return null;
}
  const category = service.benefit_limit.benefit_category;
  const unit = service.benefit_limit.unit;
  const remaining = Math.max(
    0,
    sessionAcc.benefit_limits_remaining.get(category) ?? service.benefit_limit.max,
  );

  if (remaining <= 0) {
    return {
      service,
      category,
      unit,
      remaining,
      rawAllowed,
      allowed: 0,
      consumed: 0,
      adjustment: rawAllowed,
      exhausted: true,
      partial: false,
    };
  }

  if (unit === 'dollars') {
    const allowed = Math.min(rawAllowed, remaining);

    return {
      service,
      category,
      unit,
      remaining,
      rawAllowed,
      allowed,
      consumed: allowed,
      adjustment: Math.max(0, rawAllowed - allowed),
      exhausted: false,
      partial: allowed < rawAllowed,
    };
  }

  const requestedUnits = Math.max(0, line.units);
  const effectiveUnits = Math.min(requestedUnits, remaining);

  if (requestedUnits <= 0) {
    return {
      service,
      category,
      unit,
      remaining,
      rawAllowed,
      allowed: rawAllowed,
      consumed: 0,
      adjustment: 0,
      exhausted: false,
      partial: false,
    };
  }

  const unitRatio = effectiveUnits / requestedUnits;
  const allowed = roundCents(rawAllowed * unitRatio);

  return {
    service,
    category,
    unit,
    remaining,
    rawAllowed,
    allowed,
    consumed: effectiveUnits,
    adjustment: Math.max(0, rawAllowed - allowed),
    exhausted: false,
    partial: effectiveUnits < requestedUnits,
  };
}

function decrementBenefitLimit(
  sessionAcc: SessionAccumulator,
  benefit: BenefitLimitContext | null,
): Map<string, number> {
  const nextLimits = new Map(sessionAcc.benefit_limits_remaining);

  if (!benefit) return nextLimits;

  const current = Math.max(
    0,
    nextLimits.get(benefit.category) ?? benefit.remaining,
  );

  nextLimits.set(
    benefit.category,
    Math.max(0, current - benefit.consumed),
  );

  return nextLimits;
}

function assertLineInvariant(args: {
  lineId: string;
  allowed: number;
  planPaid: number;
  memberResp: number;
  contractualAdj: number;
  cobPriorPaid: number;
  cobAdjustment: number;
}): void {
  const accounted =
    args.planPaid +
    args.memberResp +
    args.cobPriorPaid +
    args.cobAdjustment;

  if (accounted !== args.allowed) {
    throw new Error(
      `Line invariant failed for ${args.lineId}: planPaid + memberResp + cobPriorPaid + cobAdjustment must equal allowed. ` +
        `Got ${accounted}, expected ${args.allowed}.`,
    );
  }

  if (args.planPaid < 0 || args.memberResp < 0) {
    throw new Error(`Negative adjudication result for ${args.lineId}.`);
  }
}

export function adjudicateLine(
  line: ClaimLine,
  sessionAcc: SessionAccumulator,
  contract: ContractTerms,
  plan: PlanBenefits,
  priorOutcomes: PriorPayerOutcome[],
  ruleFirings: RuleFiring[],
  mathSteps: MathStep[],
): { result: AdjudicationLineResult; nextAcc: SessionAccumulator } {
  const adjustments: AdjustmentDetail[] = [];
  const cobAllocations: COBAllocation[] = [];

  const rawAllowed = calculateAllowed(line, contract);
  const benefitLimit = applyBenefitLimit(line, rawAllowed, plan, sessionAcc);
  const allowed = benefitLimit?.allowed ?? rawAllowed;

  ruleFirings.push(
    createRuleFiring(
      ruleFirings.length,
      'PRICING_001',
      'pricing',
      { billed: line.billed_amount, procedure: line.procedure_code },
      { allowed: rawAllowed },
      ['frag_pricing_fee_schedule'],
    ),
  );

  if (benefitLimit) {
    ruleFirings.push(
      createRuleFiring(
        ruleFirings.length,
        benefitLimit.exhausted
          ? 'BENEFIT_LIMIT_EXHAUSTED'
          : benefitLimit.partial
            ? 'BENEFIT_LIMIT_PARTIAL'
            : 'BENEFIT_LIMIT_001',
        'benefit_limit',
        {
          procedure: line.procedure_code,
          benefit_category: benefitLimit.category,
          unit: benefitLimit.unit,
          remaining: benefitLimit.remaining,
          requested_units: line.units,
          raw_allowed: rawAllowed,
        },
        {
          allowed_after_limit: allowed,
          consumed: benefitLimit.consumed,
          adjustment: benefitLimit.adjustment,
        },
        ['frag_benefit_limit_applied'],
      ),
    );
  }

  if (benefitLimit?.adjustment && benefitLimit.adjustment > 0) {
    adjustments.push({
      reason_code: benefitLimit.exhausted
        ? 'BENEFIT_LIMIT_EXHAUSTED'
        : 'BENEFIT_LIMIT_PARTIAL',
      amount: benefitLimit.adjustment,
      category: 'benefit_limit',
    });
  }

  if (benefitLimit?.exhausted) {
    const exhaustedContractualAdj = line.billed_amount - rawAllowed;
    if (exhaustedContractualAdj > 0) {
      adjustments.push({
        reason_code: 'CONTRACTUAL',
        amount: exhaustedContractualAdj,
        category: 'contractual',
      });
    }

    const result: AdjudicationLineResult = {
      line_id: line.line_id,
      claim_id: line.claim_id,
      allowed: 0,
      deductible_applied: 0,
      coinsurance: 0,
      copay: 0,
      plan_paid: 0,
      member_responsibility: 0,
      adjustments,
      cob_allocations: [],
      status: 'benefit_limit_exhausted',
      denial_reasons: [`Benefit limit exhausted for ${benefitLimit.category}`],
    };

    mathSteps.push(
      createMathStep(line.line_id, line.billed_amount, 0, 0, 0, 0, 0, 0),
    );

    return {
      result,
      nextAcc: {
        ...sessionAcc,
        benefit_limits_remaining: decrementBenefitLimit(sessionAcc, benefitLimit),
        lines_processed: [...sessionAcc.lines_processed, line.line_id],
      },
    };
  }

  if (allowed === 0) {
    ruleFirings.push(
      createRuleFiring(
        ruleFirings.length,
        'DENIAL_001',
        'denial',
        { procedure: line.procedure_code },
        { denied: true, reason: 'not_in_fee_schedule' },
        ['frag_denial_non_covered'],
      ),
    );

    const result: AdjudicationLineResult = {
      line_id: line.line_id,
      claim_id: line.claim_id,
      allowed: 0,
      deductible_applied: 0,
      coinsurance: 0,
      copay: 0,
      plan_paid: 0,
      member_responsibility: line.billed_amount,
      adjustments: [
        ...adjustments,
        {
          reason_code: 'NON_COVERED',
          amount: line.billed_amount,
          category: 'non_covered',
        },
      ],
      cob_allocations: [],
      status: 'denied',
      denial_reasons: ['Service not covered under contract'],
    };

    mathSteps.push(
      createMathStep(line.line_id, line.billed_amount, 0, 0, 0, 0, 0, 0),
    );

    return {
      result,
      nextAcc: {
        ...sessionAcc,
        benefit_limits_remaining: decrementBenefitLimit(sessionAcc, benefitLimit),
        lines_processed: [...sessionAcc.lines_processed, line.line_id],
      },
    };
  }

  const contractualAdj = line.billed_amount - rawAllowed;
  const benefitLimitAdj = Math.max(0, rawAllowed - allowed);

  if (contractualAdj > 0) {
    adjustments.push({
      reason_code: 'CONTRACTUAL',
      amount: contractualAdj,
      category: 'contractual',
    });
  }

  if (benefitLimitAdj > 0 && !adjustments.some((a) => a.category === 'benefit_limit')) {
    adjustments.push({
      reason_code: 'BENEFIT_LIMIT_PARTIAL',
      amount: benefitLimitAdj,
      category: 'benefit_limit',
    });
  }

  const linePrior = priorOutcomes.filter((po) => po.claim_line_id === line.line_id);

  let cobPriorPaid = 0;
  let cobAdjustment = 0;

  if (linePrior.length > 0) {
    const cobResult = calculateCOBAllocation(allowed, linePrior, plan.cob_policy);

    cobPriorPaid = cobResult.total_prior_paid;
    cobAdjustment = cobResult.adjustment;
    cobAllocations.push(...cobResult.allocations);

    ruleFirings.push(
      createRuleFiring(
        ruleFirings.length,
        'COB_ALLOC_001',
        'cob_allocation',
        {
          allowed,
          prior_outcomes: linePrior.map((p) => ({
            payer: p.payer_id,
            paid: p.paid,
          })),
        },
        {
          cob_prior_paid: cobPriorPaid,
          cob_adjustment: cobAdjustment,
          method: plan.cob_policy,
        },
        ['frag_cob_secondary_calc'],
      ),
    );

    if (cobAdjustment > 0) {
      adjustments.push({
        reason_code: 'COB_ADJUSTMENT',
        amount: cobAdjustment,
        category: 'cob',
      });
    }
  }

  const amountForCostSharing = Math.max(0, allowed - cobPriorPaid - cobAdjustment);

  const deductibleApplicable = Math.min(
    amountForCostSharing,
    sessionAcc.deductible_remaining,
  );

  const afterDeductible = amountForCostSharing - deductibleApplicable;

  if (deductibleApplicable > 0) {
    adjustments.push({
      reason_code: 'DEDUCTIBLE',
      amount: deductibleApplicable,
      category: 'deductible',
    });

    ruleFirings.push(
      createRuleFiring(
        ruleFirings.length,
        'DEDUCTIBLE_001',
        'deductible',
        {
          amount: amountForCostSharing,
          deductible_remaining: sessionAcc.deductible_remaining,
        },
        { deductible_applied: deductibleApplicable },
        ['frag_deductible_applied'],
      ),
    );
  }

  const requestedCopay =
    plan.copay_amount && plan.copay_applies_to?.includes(line.procedure_code)
      ? plan.copay_amount
      : 0;

  const copay = Math.min(requestedCopay, afterDeductible);

  if (copay > 0) {
    adjustments.push({
      reason_code: 'COPAY',
      amount: copay,
      category: 'copay',
    });

    ruleFirings.push(
      createRuleFiring(
        ruleFirings.length,
        'COPAY_001',
        'copay',
        { procedure: line.procedure_code, copay_amount: plan.copay_amount },
        { copay },
        ['frag_copay_applied'],
      ),
    );
  }

  const coinsuranceBase = Math.max(0, afterDeductible - copay);
  const coinsurance = roundCents(coinsuranceBase * plan.coinsurance_rate);

  if (coinsurance > 0) {
    adjustments.push({
      reason_code: 'COINSURANCE',
      amount: coinsurance,
      category: 'coinsurance',
    });

    ruleFirings.push(
      createRuleFiring(
        ruleFirings.length,
        'COINSURANCE_001',
        'coinsurance',
        { after_deductible: afterDeductible, copay, rate: plan.coinsurance_rate },
        { coinsurance },
        ['frag_coinsurance_applied'],
      ),
    );
  }

  const memberRespBeforeOop = roundCents(deductibleApplicable + copay + coinsurance);
  const oopApplied = Math.min(memberRespBeforeOop, sessionAcc.oop_remaining);
  const oopExcess = memberRespBeforeOop - oopApplied;

  let memberResp = oopApplied;
  let planPaid = amountForCostSharing - memberResp;

  if (oopExcess > 0) {
    adjustments.push({
      reason_code: 'OOP_MAX_PROTECTION',
      amount: oopExcess,
      category: 'oop_max',
    });

    ruleFirings.push(
      createRuleFiring(
        ruleFirings.length,
        'OOP_MAX_001',
        'oop_max',
        {
          member_resp_before_oop: memberRespBeforeOop,
          oop_remaining: sessionAcc.oop_remaining,
        },
        {
          member_responsibility_after_oop: memberResp,
          plan_assumed_oop_excess: oopExcess,
        },
        ['frag_oop_max_protection'],
      ),
    );
  }

  memberResp = roundCents(memberResp);
  planPaid = roundCents(Math.max(0, planPaid));

  assertLineInvariant({
    lineId: line.line_id,
    allowed,
    planPaid,
    memberResp,
    contractualAdj,
    cobPriorPaid,
    cobAdjustment,
  });

  const nextAcc: SessionAccumulator = {
    deductible_remaining: Math.max(
      0,
      sessionAcc.deductible_remaining - deductibleApplicable,
    ),
    oop_remaining: Math.max(0, sessionAcc.oop_remaining - oopApplied),
    benefit_limits_remaining: decrementBenefitLimit(sessionAcc, benefitLimit),
    lines_processed: [...sessionAcc.lines_processed, line.line_id],
  };

  mathSteps.push(
    createMathStep(
      line.line_id,
      line.billed_amount,
      allowed,
      deductibleApplicable,
      coinsurance,
      copay,
      planPaid,
      memberResp,
      cobPriorPaid,
      cobAdjustment,
    ),
  );

  return {
    result: {
      line_id: line.line_id,
      claim_id: line.claim_id,
      allowed,
      deductible_applied: deductibleApplicable,
      coinsurance,
      copay,
      plan_paid: planPaid,
      member_responsibility: memberResp,
      adjustments,
      cob_allocations: cobAllocations,
      status:
        benefitLimit?.partial
          ? 'benefit_limit_partial'
          : planPaid > 0
            ? 'paid'
            : memberResp > 0
              ? 'deductible_applied'
              : 'denied',
    },
    nextAcc,
  };
}

export function adjudicateClaim(
  lines: ClaimLine[],
  accumulators: MemberAccumulators,
  contract: ContractTerms,
  plan: PlanBenefits,
  priorOutcomes: PriorPayerOutcome[] = [],
  options: AdjudicationOptions = {},
): { run: AdjudicationRun; trace: TraceObject } {
  resetIdCounter();

  const claimId = lines[0]?.claim_id ?? 'unknown';
  const rid = options.runId ?? `run_${claimId}_${CALC_POLICY_VERSION}`;
  const timestamp = options.timestamp ?? '1970-01-01T00:00:00.000Z';

  const sortedLines = sortLines(lines);
  const lineOrder = sortedLines.map((line) => line.line_id);

  let sessionAcc = initSessionAccumulator(accumulators);
  const lineResults: AdjudicationLineResult[] = [];
  const ruleFirings: RuleFiring[] = [];
  const mathSteps: MathStep[] = [];

  for (const line of sortedLines) {
    const { result, nextAcc } = adjudicateLine(
      line,
      sessionAcc,
      contract,
      plan,
      priorOutcomes,
      ruleFirings,
      mathSteps,
    );

    lineResults.push(result);
    sessionAcc = nextAcc;
  }

  const totalPlanPaid = lineResults.reduce((sum, result) => sum + result.plan_paid, 0);
  const totalMemberResp = lineResults.reduce(
    (sum, result) => sum + result.member_responsibility,
    0,
  );

  const trace = buildTrace(
    rid,
    claimId,
    plan,
    contract,
    ruleFirings,
    mathSteps,
    {
      fingerprint: options.traceFingerprint,
      timestamp,
      snapshotRef: options.snapshotRef,
      traceId: options.traceId,
    },
  );

  const run: AdjudicationRun = {
    run_id: rid,
    claim_id: claimId,
    timestamp,
    line_processing_order: lineOrder,
    line_results: lineResults,
    final_accumulator: sessionAcc,
    total_plan_paid: totalPlanPaid,
    total_member_responsibility: totalMemberResp,
    trace_id: trace.trace_id,
    calc_policy_version: CALC_POLICY_VERSION,
  };

  return { run, trace };
}