import { describe, it, expect, beforeEach } from 'vitest';
import { adjudicateClaim, resetIdCounter } from '@/engine/calculation-engine';
import type {
  ClaimLine,
  MemberAccumulators,
  ContractTerms,
  PlanBenefits,
  PriorPayerOutcome,
} from '@/types/claim';

// Fixtures
function makeClaimLine(overrides: Partial<ClaimLine> = {}): ClaimLine {
  return {
    line_id: 'line_1',
    claim_id: 'CLM-BL-001',
    service_date: '2024-03-15',
    claim_line_number: 1,
    procedure_code: '99213',
    diagnosis_codes: ['J06.9'],
    billed_amount: 15000,
    units: 1,
    place_of_service: '11',
    ...overrides,
  };
}

function makeAccumulators(overrides: Partial<MemberAccumulators> = {}): MemberAccumulators {
  return {
    member_id: 'MEM-001',
    plan_year: 2024,
    individual_deductible_used: 100000, // fully met — isolates benefit-limit logic
    individual_deductible_max: 100000,
    family_deductible_used: 0,
    family_deductible_max: 300000,
    individual_oop_used: 0,
    individual_oop_max: 500000,
    family_oop_used: 0,
    family_oop_max: 1000000,
    benefit_limits: [],
    ...overrides,
  };
}

function makeContract(): ContractTerms {
  const fs = new Map<string, number>();
  fs.set('99213', 12000); // $120 allowed
  fs.set('99215', 25000); // $250 allowed
  return {
    contract_id: 'CTR-001',
    contract_version: '1.0',
    provider_npi: '1234567890',
    effective_date: '2024-01-01',
    term_date: '2024-12-31',
    fee_schedule_id: 'FS-001',
    fee_schedule: fs,
    reimbursement_method: 'fee_schedule',
  };
}

function makePlanWithDollarLimit(limitCents: number, usedCents = 0): PlanBenefits {
  return {
    plan_id: 'PLN-001',
    plan_version: '1.0',
    plan_name: 'Gold PPO',
    plan_year: 2024,
    deductible_individual: 0, // fully met — simpler to isolate benefit-limit logic
    deductible_family: 0,
    oop_max_individual: 1000000,
    oop_max_family: 2000000,
    coinsurance_rate: 0.2,
    cob_policy: 'standard',
    covered_services: [
      {
        category: 'office_visit',
        procedure_codes: ['99213', '99215'],
        requires_auth: false,
        benefit_limit: {
          benefit_category: 'office_visit',
          period: 'annual',
          used: usedCents,
          max: limitCents,
          unit: 'dollars',
        },
      },
    ],
  };
}

function makePlanWithVisitLimit(maxVisits: number, usedVisits = 0): PlanBenefits {
  return {
    plan_id: 'PLN-002',
    plan_version: '1.0',
    plan_name: 'Silver PPO',
    plan_year: 2024,
    deductible_individual: 0,
    deductible_family: 0,
    oop_max_individual: 1000000,
    oop_max_family: 2000000,
    coinsurance_rate: 0.0,
    cob_policy: 'standard',
    covered_services: [
      {
        category: 'office_visit',
        procedure_codes: ['99213'],
        requires_auth: false,
        benefit_limit: {
          benefit_category: 'office_visit',
          period: 'annual',
          used: usedVisits,
          max: maxVisits,
          unit: 'visits',
        },
      },
    ],
  };
}

describe('Benefit Limits', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('Dollar-unit benefit limits', () => {
    it('allows full payment when benefit limit is not exhausted', async () => {
      // Limit = $500, allowed = $120 — benefit limit does not reduce allowed
      const plan = makePlanWithDollarLimit(50000); // $500 limit, $0 used
      const acc = makeAccumulators({
        benefit_limits: [{ benefit_category: 'office_visit', period: 'annual', used: 0, max: 50000, unit: 'dollars' }],
      });
      const { run } = adjudicateClaim([makeClaimLine()], acc, makeContract(), plan, []);
      const result = run.line_results[0];

      // Allowed is full $120 — benefit limit not exhausted
      expect(result.allowed).toBe(12000);
      expect(result.status).not.toBe('benefit_limit_exhausted');
      expect(result.status).not.toBe('benefit_limit_partial');
    });

    it('caps allowed at remaining dollar limit when limit is partially exhausted', async () => {
      // Limit = $200, $100 already used → $100 remaining; claim = $120 allowed
      const plan = makePlanWithDollarLimit(20000, 10000); // max=$200, used=$100 → $100 left
      const acc = makeAccumulators({
        benefit_limits: [{ benefit_category: 'office_visit', period: 'annual', used: 10000, max: 20000, unit: 'dollars' }],
      });
      const { run } = adjudicateClaim([makeClaimLine()], acc, makeContract(), plan, []);
      const result = run.line_results[0];

      expect(result.allowed).toBe(10000); // capped at $100 remaining
      expect(result.status).toBe('benefit_limit_partial');
    });

    it('denies claim entirely when dollar benefit limit is fully exhausted', async () => {
      // Limit = $100, $100 already used → $0 remaining
      const plan = makePlanWithDollarLimit(10000, 10000);
      const acc = makeAccumulators({
        benefit_limits: [{ benefit_category: 'office_visit', period: 'annual', used: 10000, max: 10000, unit: 'dollars' }],
      });
      const { run } = adjudicateClaim([makeClaimLine()], acc, makeContract(), plan, []);
      const result = run.line_results[0];

      expect(result.status).toBe('benefit_limit_exhausted');
      expect(result.allowed).toBe(0);
      expect(result.plan_paid).toBe(0);
    });

    it('tracks benefit limit consumption across multiple lines in a claim', async () => {
      // Limit = $150. Line 1 = $120 allowed → $30 remaining. Line 2 = $120 allowed → capped at $30.
      const plan = makePlanWithDollarLimit(15000); // $150 limit
      const acc = makeAccumulators({
        benefit_limits: [{ benefit_category: 'office_visit', period: 'annual', used: 0, max: 15000, unit: 'dollars' }],
      });
      const line1 = makeClaimLine({ line_id: 'line_1', claim_line_number: 1 });
      const line2 = makeClaimLine({ line_id: 'line_2', claim_line_number: 2, procedure_code: '99213' });

      const { run } = adjudicateClaim([line1, line2], acc, makeContract(), plan, []);

      expect(run.line_results[0].allowed).toBe(12000); // full $120
      expect(run.line_results[1].status).toBe('benefit_limit_partial');
      expect(run.line_results[1].allowed).toBe(3000); // only $30 left
    });
  });

  describe('Visit-unit benefit limits', () => {
    it('allows full payment when visit limit is not exhausted', async () => {
      // 10 visits allowed, 0 used, claim = 1 visit
      const plan = makePlanWithVisitLimit(10, 0);
      const acc = makeAccumulators({
        benefit_limits: [{ benefit_category: 'office_visit', period: 'annual', used: 0, max: 10, unit: 'visits' }],
      });
      const { run } = adjudicateClaim([makeClaimLine({ units: 1 })], acc, makeContract(), plan, []);
      expect(run.line_results[0].allowed).toBe(12000);
    });

    it('partially pays claim when visit limit is partially exhausted', async () => {
      // 3 visits allowed, 2 used → 1 remaining; claim = 2 visits
      const plan = makePlanWithVisitLimit(3, 2); // 1 visit remaining
      const acc = makeAccumulators({
        benefit_limits: [{ benefit_category: 'office_visit', period: 'annual', used: 2, max: 3, unit: 'visits' }],
      });
      const line = makeClaimLine({ units: 2, billed_amount: 30000 }); // 2 visits billed

      const { run } = adjudicateClaim([line], acc, makeContract(), plan, []);
      const result = run.line_results[0];

      // 1 of 2 requested visits covered → 50% of rawAllowed (24000) = 12000
      expect(result.status).toBe('benefit_limit_partial');
      expect(result.allowed).toBe(12000); // 1 visit covered at $120 each
    });

    it('denies claim when visit limit is fully exhausted', async () => {
      // 5 visits max, 5 used → 0 remaining
      const plan = makePlanWithVisitLimit(5, 5);
      const acc = makeAccumulators({
        benefit_limits: [{ benefit_category: 'office_visit', period: 'annual', used: 5, max: 5, unit: 'visits' }],
      });
      const { run } = adjudicateClaim([makeClaimLine({ units: 1 })], acc, makeContract(), plan, []);
      expect(run.line_results[0].status).toBe('benefit_limit_exhausted');
      expect(run.line_results[0].plan_paid).toBe(0);
    });
  });

  describe('MOB COB with active deductible interaction', () => {
    it('secondary bridging gap still applies member deductible first', () => {
      // Primary paid $60 (out of $120 allowed). MOB policy: secondary can pay the $60 gap.
      // But secondary has $50 deductible remaining → member owes $50, plan pays $10 gap.
      const plan: PlanBenefits = {
        plan_id: 'PLN-MOB',
        plan_version: '1.0',
        plan_name: 'MOB Plan',
        plan_year: 2024,
        deductible_individual: 5000,
        deductible_family: 10000,
        oop_max_individual: 500000,
        oop_max_family: 1000000,
        coinsurance_rate: 0.0, // 0% after deductible — isolates gap math
        cob_policy: 'maintenance_of_benefits',
        covered_services: [],
      };

      const acc = makeAccumulators({
        individual_deductible_max: 5000, // $50 deductible max
        individual_deductible_used: 0,   // none used yet → $50 remaining
      });

      const priorOutcomes: PriorPayerOutcome[] = [
        {
          payer_id: 'PRIMARY',
          payer_name: 'Primary Plan',
          claim_line_id: 'line_1', // must match makeClaimLine().line_id
          billed: 15000,
          allowed: 12000,
          paid: 6000, // $60 paid by primary
          patient_responsibility: 0,
          adjustments: [],
          source: 'edi_835',
          confidence: 1.0,
        },
      ];

      const { run } = adjudicateClaim(
        [makeClaimLine()],
        acc,
        makeContract(),
        plan,
        priorOutcomes,
      );

      const result = run.line_results[0];
      // Gap = $120 allowed - $60 primary paid = $60.
      // $50 deductible applies first → member owes $50, plan pays $10 of the gap.
      expect(result.deductible_applied).toBe(5000); // $50 deductible consumed
      expect(result.plan_paid).toBe(1000); // $10 plan pays remaining gap
    });
  });
});
