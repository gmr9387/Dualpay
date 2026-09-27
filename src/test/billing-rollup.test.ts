import { describe, it, expect } from 'vitest';
import {
  groupUnbilledDisputesByOrg,
  computeInvoiceLineItems,
  computeInvoiceSubtotal,
  computePeriod,
  buildOrgInvoiceBatches,
  type UnbilledDispute,
} from '../../supabase/functions/_shared/billing-rollup';

const dispute = (overrides: Partial<UnbilledDispute>): UnbilledDispute => ({
  dispute_id: 'd1', org_id: 'org1', claim_id: 'CLM1', payer_name: 'Aetna', assessed_fee_cents: 1000,
  created_at: '2026-09-15T00:00:00.000Z',
  ...overrides,
});

describe('groupUnbilledDisputesByOrg', () => {
  it('groups disputes by org_id', () => {
    const disputes = [
      dispute({ dispute_id: 'd1', org_id: 'org1' }),
      dispute({ dispute_id: 'd2', org_id: 'org2' }),
      dispute({ dispute_id: 'd3', org_id: 'org1' }),
    ];
    const grouped = groupUnbilledDisputesByOrg(disputes);
    expect(grouped.size).toBe(2);
    expect(grouped.get('org1')?.map((d) => d.dispute_id)).toEqual(['d1', 'd3']);
    expect(grouped.get('org2')?.map((d) => d.dispute_id)).toEqual(['d2']);
  });

  it('drops disputes with a zero or negative assessed fee', () => {
    const disputes = [
      dispute({ dispute_id: 'd1', assessed_fee_cents: 0 }),
      dispute({ dispute_id: 'd2', assessed_fee_cents: -50 }),
      dispute({ dispute_id: 'd3', assessed_fee_cents: 500 }),
    ];
    const grouped = groupUnbilledDisputesByOrg(disputes);
    expect(grouped.get('org1')?.map((d) => d.dispute_id)).toEqual(['d3']);
  });

  it('returns an empty map for no disputes', () => {
    expect(groupUnbilledDisputesByOrg([]).size).toBe(0);
  });
});

describe('computeInvoiceLineItems', () => {
  it('produces one line item per dispute with a readable description', () => {
    const items = computeInvoiceLineItems([
      dispute({ dispute_id: 'd1', claim_id: 'CLM100', payer_name: 'Cigna', assessed_fee_cents: 2500 }),
    ]);
    expect(items).toEqual([
      { dispute_id: 'd1', description: 'Recovery fee — claim CLM100 (Cigna)', amount_cents: 2500 },
    ]);
  });
});

describe('computeInvoiceSubtotal', () => {
  it('sums line item amounts', () => {
    const items = computeInvoiceLineItems([
      dispute({ dispute_id: 'd1', assessed_fee_cents: 1000 }),
      dispute({ dispute_id: 'd2', assessed_fee_cents: 2500 }),
    ]);
    expect(computeInvoiceSubtotal(items)).toBe(3500);
  });

  it('returns 0 for no line items', () => {
    expect(computeInvoiceSubtotal([])).toBe(0);
  });
});

describe('computePeriod', () => {
  it('spans earliest to latest created_at, truncated to a date', () => {
    const disputes = [
      dispute({ created_at: '2026-09-03T14:22:00.000Z' }),
      dispute({ created_at: '2026-09-28T02:00:00.000Z' }),
      dispute({ created_at: '2026-09-15T00:00:00.000Z' }),
    ];
    expect(computePeriod(disputes)).toEqual({ period_start: '2026-09-03', period_end: '2026-09-28' });
  });

  it('collapses to a single day when there is only one dispute', () => {
    const disputes = [dispute({ created_at: '2026-09-10T00:00:00.000Z' })];
    expect(computePeriod(disputes)).toEqual({ period_start: '2026-09-10', period_end: '2026-09-10' });
  });
});

describe('buildOrgInvoiceBatches', () => {
  it('builds one batch per org with correct subtotal and dispute_count', () => {
    const disputes = [
      dispute({ dispute_id: 'd1', org_id: 'org1', assessed_fee_cents: 1000 }),
      dispute({ dispute_id: 'd2', org_id: 'org1', assessed_fee_cents: 2000 }),
      dispute({ dispute_id: 'd3', org_id: 'org2', assessed_fee_cents: 500 }),
    ];
    const batches = buildOrgInvoiceBatches(disputes);
    expect(batches).toHaveLength(2);
    const org1 = batches.find((b) => b.org_id === 'org1')!;
    expect(org1.subtotal_cents).toBe(3000);
    expect(org1.dispute_count).toBe(2);
    const org2 = batches.find((b) => b.org_id === 'org2')!;
    expect(org2.subtotal_cents).toBe(500);
    expect(org2.dispute_count).toBe(1);
  });

  it('produces no batches when every dispute has a zero fee', () => {
    const disputes = [dispute({ assessed_fee_cents: 0 })];
    expect(buildOrgInvoiceBatches(disputes)).toEqual([]);
  });
});
