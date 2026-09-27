-- Stripe billing for contingency fees: monthly rollup via ACH.
-- Adds Stripe customer linkage to organizations and a billing_invoices
-- table that aggregates recovered-but-unbilled underpayment_disputes into
-- one invoice per org per billing cycle.

ALTER TABLE dualpay.organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS billing_email text,
  ADD COLUMN IF NOT EXISTS ach_connected_at timestamptz;

CREATE TABLE IF NOT EXISTS dualpay.billing_invoices (
  invoice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES dualpay.organizations(org_id),
  stripe_invoice_id text NOT NULL UNIQUE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'paid', 'payment_failed', 'void', 'uncollectible')),
  subtotal_cents integer NOT NULL DEFAULT 0,
  dispute_count integer NOT NULL DEFAULT 0,
  hosted_invoice_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_org
  ON dualpay.billing_invoices(org_id, created_at DESC);

ALTER TABLE dualpay.underpayment_disputes
  ADD COLUMN IF NOT EXISTS billing_invoice_id uuid REFERENCES dualpay.billing_invoices(invoice_id);

-- Fast lookup for the monthly rollup: recovered disputes with a real fee
-- that haven't been attached to an invoice yet.
CREATE INDEX IF NOT EXISTS idx_underpayment_disputes_unbilled
  ON dualpay.underpayment_disputes(org_id)
  WHERE status = 'recovered' AND assessed_fee_cents > 0 AND billing_invoice_id IS NULL;

ALTER TABLE dualpay.billing_invoices ENABLE ROW LEVEL SECURITY;

-- Financial records are read-only to admin/owner, and written exclusively
-- by Edge Functions on the service_role key (which bypasses RLS) — no
-- insert/update/delete policy is granted to authenticated users.
CREATE POLICY billing_invoices_select ON dualpay.billing_invoices
  FOR SELECT
  USING (dualpay.has_org_role(org_id, (SELECT auth.uid()), ARRAY['admin', 'owner']));
