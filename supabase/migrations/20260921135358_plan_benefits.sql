-- Phase 22 — Plan Benefits.
-- Real, admin-entered plan benefit data (deductibles, OOP max, coinsurance,
-- covered services) — the other half of the foundation the local
-- adjudication kernel needs. Same pattern as payer_contracts: org-scoped,
-- versioned, manually uploaded by staff (no external eligibility/834 feed
-- exists yet, same as payer_contracts never auto-fetches either).

CREATE TABLE public.plan_benefits (
  plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  payer_name text NOT NULL,
  plan_name text NOT NULL,
  plan_version text NOT NULL DEFAULT '1',
  plan_year integer NOT NULL,
  deductible_individual bigint NOT NULL DEFAULT 0,
  deductible_family bigint NOT NULL DEFAULT 0,
  oop_max_individual bigint NOT NULL DEFAULT 0,
  oop_max_family bigint NOT NULL DEFAULT 0,
  coinsurance_rate numeric NOT NULL DEFAULT 0,
  copay_amount bigint,
  cob_policy text NOT NULL DEFAULT 'standard',
  covered_services jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_date date NOT NULL,
  termination_date date,
  uploaded_by text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_benefits TO authenticated;
GRANT ALL ON public.plan_benefits TO service_role;
ALTER TABLE public.plan_benefits ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER plan_benefits_set_org BEFORE INSERT ON public.plan_benefits
  FOR EACH ROW EXECUTE FUNCTION public.set_default_org_id();
CREATE TRIGGER plan_benefits_touch BEFORE UPDATE ON public.plan_benefits
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE POLICY "plan_benefits_select" ON public.plan_benefits FOR SELECT
  USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY "plan_benefits_insert" ON public.plan_benefits FOR INSERT
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['analyst','manager','admin','owner']));
CREATE POLICY "plan_benefits_update" ON public.plan_benefits FOR UPDATE
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['analyst','manager','admin','owner']));
CREATE POLICY "plan_benefits_delete" ON public.plan_benefits FOR DELETE
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['manager','admin','owner']));
CREATE INDEX plan_benefits_org_payer_idx ON public.plan_benefits(org_id, payer_name);
