-- Phase 23 — Payer-side capability, Phase 1 (dispute direction).
-- underpayment_disputes has, until now, only ever stored the provider
-- underpayment direction (dispute-generator gated on is_underpayment).
-- Adds `direction` so the same table/pipeline can also carry payer
-- overpayment findings ("find lost money") without a parallel table.
-- Additive: existing rows default to 'underpayment', matching their
-- actual (only) meaning up to now.

ALTER TABLE dualpay.underpayment_disputes
  ADD COLUMN direction text NOT NULL DEFAULT 'underpayment'
    CHECK (direction IN ('underpayment', 'overpayment'));

COMMENT ON COLUMN dualpay.underpayment_disputes.direction IS
  'underpayment: provider was shorted (existing Recovery Ops flow). overpayment: payer paid too much (payment-integrity / "find lost money" flow).';
