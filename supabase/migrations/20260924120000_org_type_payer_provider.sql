-- Phase 23 — Payer-side capability, Phase 1 (org_type).
-- Adds a tenant-type distinction so an organization can be a 'provider'
-- (existing behavior, default) or a 'payer' (payment-integrity / "find lost
-- money" use case). Additive only: existing rows default to 'provider', no
-- existing query or RLS policy changes behavior.

ALTER TABLE dualpay.organizations
  ADD COLUMN org_type text NOT NULL DEFAULT 'provider'
    CHECK (org_type IN ('provider', 'payer'));

COMMENT ON COLUMN dualpay.organizations.org_type IS
  'provider: recovers underpayments from payers (existing flow). payer: finds overpayments made to providers (payment-integrity flow).';
