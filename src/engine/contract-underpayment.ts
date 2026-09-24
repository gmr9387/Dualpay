/**
 * Phase 15 — True Underpayment Engine.
 * Computes Expected Reimbursement from a matched contract/fee row, then compares to
 * the allowed and paid amounts on the remittance to surface a true variance.
 *
 * Variance is direction-agnostic by construction: expected > actual is a
 * provider underpayment (Recovery Ops' existing use), expected < actual is a
 * payer overpayment (payment-integrity / "find lost money" use). Both read
 * the same fee schedule match and the same computeExpected() — only the
 * comparison direction differs.
 */
import type { FeeScheduleRow } from '@/types/contracts';
import type { DisputeSeverity } from '@/types/contracts';

export interface UnderpaymentInput {
  billed_cents: number;
  allowed_cents: number;
  paid_cents: number;
  fee?: FeeScheduleRow;
  medicare_allowable_cents?: number;
}

export type VarianceDirection = 'underpayment' | 'overpayment' | 'none';

export interface UnderpaymentResult {
  expected_cents: number;
  variance_cents: number;
  variance_percent: number;
  severity: DisputeSeverity;
  /** @deprecated use `direction === 'underpayment'` */
  is_underpayment: boolean;
  is_overpayment: boolean;
  direction: VarianceDirection;
  confidence: number; // 0-100
  explanation: string;
}

const VARIANCE_THRESHOLD_CENTS = 1_00;  // ignore <$1 rounding
const VARIANCE_THRESHOLD_PCT  = 2;      // ignore <2%

export function computeExpected(input: UnderpaymentInput): { expected: number; confidence: number; basis: string } {
  const { fee, billed_cents, medicare_allowable_cents } = input;
  if (!fee) {
    return { expected: 0, confidence: 0, basis: 'No fee schedule matched — cannot compute expected reimbursement' };
  }
  switch (fee.reimbursement_method) {
    case 'fixed_fee':
    case 'case_rate':
    case 'per_diem':
      return { expected: fee.contracted_amount_cents, confidence: 95, basis: `${fee.reimbursement_method} @ $${(fee.contracted_amount_cents/100).toFixed(2)}` };
    case 'percent_of_billed': {
      const pct = fee.contracted_amount_cents / 10000; // stored as basis-points * 100
      return { expected: Math.round(billed_cents * pct), confidence: 85, basis: `${(pct*100).toFixed(1)}% of billed` };
    }
    case 'percent_of_medicare': {
      if (!medicare_allowable_cents) {
        return { expected: 0, confidence: 30, basis: 'Medicare allowable unavailable' };
      }
      const pct = fee.contracted_amount_cents / 10000;
      return { expected: Math.round(medicare_allowable_cents * pct), confidence: 80, basis: `${(pct*100).toFixed(1)}% of Medicare` };
    }
    default:
      return { expected: fee.contracted_amount_cents, confidence: 60, basis: `Unknown method: ${fee.reimbursement_method}` };
  }
}

export function detectUnderpayment(input: UnderpaymentInput): UnderpaymentResult {
  const { expected, confidence, basis } = computeExpected(input);
  const comparison = Math.max(input.allowed_cents, input.paid_cents);
  const variance = expected - comparison; // positive = underpaid, negative = overpaid
  const variancePct = expected > 0 ? (variance / expected) * 100 : 0;
  const absVariance = Math.abs(variance);
  const absVariancePct = Math.abs(variancePct);

  const isUnder = expected > 0
    && variance > VARIANCE_THRESHOLD_CENTS
    && variancePct >= VARIANCE_THRESHOLD_PCT;
  const isOver = expected > 0
    && variance < -VARIANCE_THRESHOLD_CENTS
    && variancePct <= -VARIANCE_THRESHOLD_PCT;
  const direction: VarianceDirection = isUnder ? 'underpayment' : isOver ? 'overpayment' : 'none';

  let severity: DisputeSeverity = 'low';
  if (absVariancePct >= 25 || absVariance >= 50_000) severity = 'critical';
  else if (absVariancePct >= 15 || absVariance >= 20_000) severity = 'high';
  else if (absVariancePct >= 5  || absVariance >= 5_000) severity = 'medium';

  const explanation = isUnder
    ? `Expected $${(expected/100).toFixed(2)} (${basis}); paid/allowed $${(comparison/100).toFixed(2)}. Underpaid $${(absVariance/100).toFixed(2)} (${absVariancePct.toFixed(1)}%).`
    : isOver
    ? `Expected $${(expected/100).toFixed(2)} (${basis}); paid/allowed $${(comparison/100).toFixed(2)}. Overpaid $${(absVariance/100).toFixed(2)} (${absVariancePct.toFixed(1)}%).`
    : `Within tolerance. ${basis}. Expected $${(expected/100).toFixed(2)}, paid/allowed $${(comparison/100).toFixed(2)}.`;

  return {
    expected_cents: expected,
    variance_cents: variance,
    variance_percent: variancePct,
    severity,
    is_underpayment: isUnder,
    is_overpayment: isOver,
    direction,
    confidence,
    explanation,
  };
}
