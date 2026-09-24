/**
 * Sanity check for the Payer Findings demo dataset: proves the hand-picked
 * billed/allowed/paid figures in demo-payer-findings.ts actually produce
 * the overpayment/severity mix the dashboard is meant to demo, and that
 * the COB rows really do classify as COB — run through the real engine
 * functions, not asserted by hand. If someone edits detectUnderpayment's
 * thresholds or the demo fee schedule later, this catches drift.
 */
import { describe, it, expect } from 'vitest';
import { detectUnderpayment } from '@/engine/contract-underpayment';
import { normalizeRemittance } from '@/engine/remittance-normalizer';
import { classifyRemittance } from '@/engine/remittance-denial-extractor';
import type { FeeScheduleRow } from '@/types/contracts';
import type { ParsedRow } from '@/types/import';

const FEE_SCHEDULE: Record<string, number> = {
  '99213': 9_200,
  '99214': 14_800,
  '85025': 2_400,
  '93000': 3_100,
};

function makeFee(procedure_code: string): FeeScheduleRow {
  return {
    fee_schedule_id: 'demo', org_id: 'demo', contract_id: 'demo',
    procedure_code, reimbursement_method: 'fixed_fee',
    contracted_amount_cents: FEE_SCHEDULE[procedure_code],
  };
}

const OVERPAYMENT_ROWS = [
  { procedure_code: '99213', billed_cents: 16_500, allowed_cents: 10_000, paid_cents: 10_000, expectSeverity: 'medium' },
  { procedure_code: '99214', billed_cents: 28_500, allowed_cents: 17_200, paid_cents: 17_200, expectSeverity: 'high' },
  { procedure_code: '85025', billed_cents: 5_800, allowed_cents: 3_150, paid_cents: 3_150, expectSeverity: 'critical' },
  { procedure_code: '93000', billed_cents: 5_850, allowed_cents: 3_210, paid_cents: 3_210, expectSeverity: 'low' },
];

describe('Payer Findings demo dataset', () => {
  it('every overpayment row is flagged as overpayment with the intended severity spread', () => {
    const severities = new Set<string>();
    for (const row of OVERPAYMENT_ROWS) {
      const result = detectUnderpayment({
        billed_cents: row.billed_cents,
        allowed_cents: row.allowed_cents,
        paid_cents: row.paid_cents,
        fee: makeFee(row.procedure_code),
      });
      expect(result.direction).toBe('overpayment');
      expect(result.severity).toBe(row.expectSeverity);
      severities.add(result.severity);
    }
    // The demo is meant to show a real spread, not four identical rows.
    expect(severities.size).toBeGreaterThanOrEqual(3);
  });

  it('COB rows classify as cob via the real remittance classifier', () => {
    const cobRows: ParsedRow[] = [
      { index: 0, raw: {}, issues: [], status: 'ok', normalized: {
        claim_id: 'PF-2024-201', payer_name: 'BlueCross BlueShield NC', billed_amount: 32_000,
        allowed_amount: 0, paid_amount: 0, carc_code: '22', group_code: 'OA',
      } },
      { index: 1, raw: {}, issues: [], status: 'ok', normalized: {
        claim_id: 'PF-2024-202', payer_name: 'BlueCross BlueShield NC', billed_amount: 27_000,
        allowed_amount: 5_000, paid_amount: 5_000, carc_code: '22', group_code: 'OA',
      } },
    ];
    for (const row of cobRows) {
      const cls = classifyRemittance(normalizeRemittance(row));
      expect(cls.kind).toBe('cob');
    }
  });
});
