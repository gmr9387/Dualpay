// Stripe billing for contingency fees — monthly rollup via ACH.
export type BillingInvoiceStatus = 'draft' | 'open' | 'paid' | 'payment_failed' | 'void' | 'uncollectible';

export interface BillingInvoice {
  invoice_id: string;
  org_id: string;
  stripe_invoice_id: string;
  period_start: string;
  period_end: string;
  status: BillingInvoiceStatus | string;
  subtotal_cents: number;
  dispute_count: number;
  hosted_invoice_url?: string | null;
  created_at: string;
  finalized_at?: string | null;
  paid_at?: string | null;
  updated_at: string;
}
