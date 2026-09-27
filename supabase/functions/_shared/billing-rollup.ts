/**
 * Shared aggregation logic for the monthly Stripe contingency-fee rollup.
 *
 * Pure and Deno-free so it can be exercised directly from the frontend's
 * vitest suite (src/test/billing-rollup.test.ts) as well as imported by the
 * stripe-billing-rollup Edge Function — no re-implementation to keep in sync.
 */

export interface UnbilledDispute {
  dispute_id: string;
  org_id: string;
  claim_id: string;
  payer_name: string;
  assessed_fee_cents: number;
  created_at: string;
}

export interface InvoiceLineItem {
  dispute_id: string;
  description: string;
  amount_cents: number;
}

export interface OrgInvoiceBatch {
  org_id: string;
  line_items: InvoiceLineItem[];
  subtotal_cents: number;
  dispute_count: number;
  /** The recovery date range this invoice covers — earliest to latest dispute created_at, truncated to a date. */
  period_start: string;
  period_end: string;
}

/**
 * Groups unbilled recovered disputes by org_id. Disputes with a non-positive
 * assessed fee are dropped — never invoice for a $0 or negative line.
 */
export function groupUnbilledDisputesByOrg(disputes: UnbilledDispute[]): Map<string, UnbilledDispute[]> {
  const byOrg = new Map<string, UnbilledDispute[]>();
  for (const d of disputes) {
    if (d.assessed_fee_cents <= 0) continue;
    const list = byOrg.get(d.org_id) ?? [];
    list.push(d);
    byOrg.set(d.org_id, list);
  }
  return byOrg;
}

/** One Stripe invoice item per dispute, so each line is independently auditable. */
export function computeInvoiceLineItems(disputes: UnbilledDispute[]): InvoiceLineItem[] {
  return disputes.map((d) => ({
    dispute_id: d.dispute_id,
    description: `Recovery fee — claim ${d.claim_id} (${d.payer_name})`,
    amount_cents: d.assessed_fee_cents,
  }));
}

export function computeInvoiceSubtotal(lineItems: InvoiceLineItem[]): number {
  return lineItems.reduce((sum, li) => sum + li.amount_cents, 0);
}

/** Earliest-to-latest created_at across a batch of disputes, truncated to a date (YYYY-MM-DD). */
export function computePeriod(disputes: UnbilledDispute[]): { period_start: string; period_end: string } {
  const dates = disputes.map((d) => d.created_at.slice(0, 10)).sort();
  return { period_start: dates[0], period_end: dates[dates.length - 1] };
}

/** Builds one invoice batch per org — the exact unit stripe-billing-rollup turns into a real Stripe invoice. */
export function buildOrgInvoiceBatches(disputes: UnbilledDispute[]): OrgInvoiceBatch[] {
  const byOrg = groupUnbilledDisputesByOrg(disputes);
  return Array.from(byOrg.entries()).map(([org_id, orgDisputes]) => {
    const line_items = computeInvoiceLineItems(orgDisputes);
    return {
      org_id,
      line_items,
      subtotal_cents: computeInvoiceSubtotal(line_items),
      dispute_count: line_items.length,
      ...computePeriod(orgDisputes),
    };
  });
}
