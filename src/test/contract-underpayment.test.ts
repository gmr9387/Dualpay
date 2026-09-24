import { describe, it, expect } from 'vitest';
import { computeExpected, detectUnderpayment } from '@/engine/contract-underpayment';
import type { FeeScheduleRow } from '@/types/contracts';

function makeFee(overrides: Partial<FeeScheduleRow> = {}): FeeScheduleRow {
  return {
    fee_schedule_id: 'fee_1',
    contract_id: 'contract_1',
    procedure_code: '99213',
    reimbursement_method: 'fixed_fee',
    contracted_amount_cents: 10_000, // $100.00
    effective_date: '2024-01-01',
    termination_date: null,
    ...overrides,
  } as FeeScheduleRow;
}

describe('contract-underpayment engine', () => {
  it('flags underpayment when paid/allowed is below the contracted amount (existing behavior)', () => {
    const result = detectUnderpayment({
      billed_cents: 15_000,
      allowed_cents: 8_000,
      paid_cents: 8_000,
      fee: makeFee(),
    });
    expect(result.direction).toBe('underpayment');
    expect(result.is_underpayment).toBe(true);
    expect(result.is_overpayment).toBe(false);
    expect(result.variance_cents).toBe(2_000);
  });

  it('flags overpayment when paid/allowed exceeds the contracted amount (payer "find lost money" case)', () => {
    const result = detectUnderpayment({
      billed_cents: 15_000,
      allowed_cents: 13_000,
      paid_cents: 13_000,
      fee: makeFee(),
    });
    expect(result.direction).toBe('overpayment');
    expect(result.is_overpayment).toBe(true);
    expect(result.is_underpayment).toBe(false);
    expect(result.variance_cents).toBe(-3_000);
  });

  it('reports no variance within tolerance', () => {
    const result = detectUnderpayment({
      billed_cents: 15_000,
      allowed_cents: 10_050, // within $1/2% threshold
      paid_cents: 10_050,
      fee: makeFee(),
    });
    expect(result.direction).toBe('none');
    expect(result.is_underpayment).toBe(false);
    expect(result.is_overpayment).toBe(false);
  });

  it('computeExpected is direction-agnostic (same math for provider and payer use)', () => {
    const under = computeExpected({ billed_cents: 15_000, allowed_cents: 8_000, paid_cents: 8_000, fee: makeFee() });
    const over = computeExpected({ billed_cents: 15_000, allowed_cents: 13_000, paid_cents: 13_000, fee: makeFee() });
    expect(under.expected).toBe(over.expected);
  });

  it('severity reflects magnitude for overpayments too, not just underpayments', () => {
    const result = detectUnderpayment({
      billed_cents: 100_000,
      allowed_cents: 60_000, // 40% over the $100 fee... use bigger contract amount
      paid_cents: 60_000,
      fee: makeFee({ contracted_amount_cents: 10_000 }),
    });
    expect(result.direction).toBe('overpayment');
    expect(result.severity).toBe('critical');
  });
});
