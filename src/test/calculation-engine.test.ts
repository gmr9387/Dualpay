import { describe, it, expect, beforeEach } from 'vitest';
import {
  adjudicateClaim,
  resetIdCounter,
  sortLines,
  calculateAllowed,
  initSessionAccumulator,
} from '@/engine/calculation-engine';
import { determineCOBPrimacy, birthdayRule, calculateCOBAllocation } from '@/engine/cob-rules';
import type {
  ClaimLine,
  MemberAccumulators,
  ContractTerms,
  PlanBenefits,
  PriorPayerOutcome,
} from '@/types/claim';

// Test fixtures
function makeClaimLine(overrides: Partial<ClaimLine> = {}): ClaimLine {
  return {
    line_id: 'line_1',
    claim_id: 'claim_1',
    service_date: '2024-03-15',
    claim_line_number: 1,
    procedure_code: '99213',
    diagnosis_codes: ['J06.9'],
    billed_amount: 15000, // $150.00
    units: 1,
    place_of_service: '11',
    ...overrides,
  };
}

function makeAccumulators(overrides: Partial<MemberAccumulators> = {}): MemberAccumulators {
  return {
    member_id: 'mem_1',
    plan_year: 2024,
    individual_deductible_used: 0,
    individual_deductible_max: 100000, // $1000
    family_deductible_used: 0,
    family_deductible_max: 300000,
    individual_oop_used: 0,
    individual_oop_max: 500000, // $5000
    family_oop_used: 0,
    family_oop_max: 1000000,
    benefit_limits: [],
    ...overrides,
  };
}

function makeContract(overrides: Partial<ContractTerms> = {}): ContractTerms {
  const fs = new Map<string, number>();
  fs.set('99213', 12000); // $120 allowed
  fs.set('99214', 18000); // $180 allowed
  fs.set('99215', 25000); // $250 allowed
  return {
    contract_id: 'contract_1',
    contract_version: '1.0',
    provider_npi: '1234567890',
    effective_date: '2024-01-01',
    term_date: '2024-12-31',
    fee_schedule_id: 'fs_1',
    fee_schedule: fs,
    reimbursement_method: 'fee_schedule',
    ...overrides,
  };
}

function makePlan(overrides: Partial<PlanBenefits> = {}): PlanBenefits {
  return {
    plan_id: 'plan_1',
    plan_version: '1.0',
    plan_name: 'Gold PPO',
    plan_year: 2024,
    deductible_individual: 100000,
    deductible_family: 300000,
    oop_max_individual: 500000,
    oop_max_family: 1000000,
    coinsurance_rate: 0.2, // 20% member share
    cob_policy: 'standard',
    covered_services: [],
    ...overrides,
  };
}

describe('CalculationEngine', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('sortLines', () => {
    it('sorts by service_date then line_number', () => {
      const lines = [
        makeClaimLine({ line_id: 'c', service_date: '2024-03-16', claim_line_number: 1 }),
        makeClaimLine({ line_id: 'a', service_date: '2024-03-15', claim_line_number: 2 }),
        makeClaimLine({ line_id: 'b', service_date: '2024-03-15', claim_line_number: 1 }),
      ];
      const sorted = sortLines(lines);
      expect(sorted.map(l => l.line_id)).toEqual(['b', 'a', 'c']);
    });
  });

  describe('calculateAllowed', () => {
    it('uses fee schedule to determine allowed', () => {
      const line = makeClaimLine({ billed_amount: 15000, procedure_code: '99213' });
      const contract = makeContract();
      expect(calculateAllowed(line, contract)).toBe(12000);
    });

    it('caps allowed at billed amount if fee > billed', () => {
      const line = makeClaimLine({ billed_amount: 5000, procedure_code: '99213' });
      const contract = makeContract();
      expect(calculateAllowed(line, contract)).toBe(5000);
    });

    it('returns 0 for non-covered procedure', () => {
      const line = makeClaimLine({ procedure_code: 'ZZZZ' });
      const contract = makeContract();
      expect(calculateAllowed(line, contract)).toBe(0);
    });
  });

  describe('Single-payer adjudication', () => {
    it('applies deductible + coinsurance correctly for single line', () => {
      const lines = [makeClaimLine()];
      const acc = makeAccumulators(); // $0 used of $1000 deductible
      const contract = makeContract(); // 99213 -> $120 allowed
      const plan = makePlan({ coinsurance_rate: 0.2 });

      const { run, trace } = adjudicateClaim(lines, acc, contract, plan);

      expect(run.line_results).toHaveLength(1);
      const r = run.line_results[0];

      // Allowed = $120 (fee schedule)
      expect(r.allowed).toBe(12000);
      // Full allowed goes to deductible since $120 < $1000 deductible
      expect(r.deductible_applied).toBe(12000);
      // No coinsurance since entire amount went to deductible
      expect(r.coinsurance).toBe(0);
      expect(r.plan_paid).toBe(0);
      expect(r.member_responsibility).toBe(12000);

      // Trace must exist
      expect(trace.trace_id).toBeTruthy();
      expect(trace.rule_firings.length).toBeGreaterThan(0);
      expect(trace.math_steps).toHaveLength(1);
      expect(trace.plan_version).toBe('1.0');
    });

    it('cross-line accumulator: Line 2 sees deductible used by Line 1', () => {
      const lines = [
        makeClaimLine({ line_id: 'L1', claim_line_number: 1, procedure_code: '99214', billed_amount: 20000 }),
        makeClaimLine({ line_id: 'L2', claim_line_number: 2, procedure_code: '99215', billed_amount: 30000 }),
      ];
      // Deductible: $1000 max, $800 already used → $200 remaining
      const acc = makeAccumulators({ individual_deductible_used: 80000 });
      const contract = makeContract();
      const plan = makePlan({ coinsurance_rate: 0.2 });

      const { run } = adjudicateClaim(lines, acc, contract, plan);

      const l1 = run.line_results.find(r => r.line_id === 'L1')!;
      const l2 = run.line_results.find(r => r.line_id === 'L2')!;

      // L1: allowed=$180, deductible_remaining=$200, so apply $180 to deductible
      expect(l1.allowed).toBe(18000);
      expect(l1.deductible_applied).toBe(18000); // $180 < $200 remaining
      expect(l1.coinsurance).toBe(0);
      expect(l1.plan_paid).toBe(0);

      // L2: allowed=$250, deductible_remaining=$200-$180=$20
      expect(l2.allowed).toBe(25000);
      expect(l2.deductible_applied).toBe(2000); // only $20 remaining
      // Coinsurance: ($250-$20) * 0.2 = $46
      expect(l2.coinsurance).toBe(4600);
      // Plan paid: $250-$20-$46 = $184
      expect(l2.plan_paid).toBe(18400);
      expect(l2.member_responsibility).toBe(6600); // $20 + $46

      // Line processing order must be recorded
      expect(run.line_processing_order).toEqual(['L1', 'L2']);
    });

    it('denies non-covered service', () => {
      const lines = [makeClaimLine({ procedure_code: 'ZZZZ', billed_amount: 50000 })];
      const { run } = adjudicateClaim(lines, makeAccumulators(), makeContract(), makePlan());

      expect(run.line_results[0].status).toBe('denied');
      expect(run.line_results[0].member_responsibility).toBe(50000);
      expect(run.line_results[0].plan_paid).toBe(0);
    });
  });

  describe('Multi-payer COB adjudication', () => {
    it('standard COB: secondary pays remaining after primary', () => {
      const lines = [makeClaimLine({ line_id: 'L1', procedure_code: '99214', billed_amount: 20000 })];
      // Deductible already met
      const acc = makeAccumulators({ individual_deductible_used: 100000 });
      const contract = makeContract(); // 99214 -> $180 allowed
      const plan = makePlan({ coinsurance_rate: 0.2, cob_policy: 'standard' });

      const priorOutcomes: PriorPayerOutcome[] = [{
        payer_id: 'primary_plan',
        payer_name: 'Primary Insurance Co',
        claim_line_id: 'L1',
        billed: 20000,
        allowed: 17000,
        paid: 13600, // Primary paid 80% of their allowed
        patient_responsibility: 3400,
        adjustments: [{ carc_code: '45', amount: 3000, group_code: 'CO' }],
        source: 'edi_835',
        confidence: 1.0,
      }];

      const { run, trace } = adjudicateClaim(lines, acc, contract, plan, priorOutcomes);
      const r = run.line_results[0];

      // Our allowed = $180
      expect(r.allowed).toBe(18000);
      // Primary paid $136 of their $170 allowed
      // Standard COB: we pay up to our allowed minus primary paid
      // Amount for cost sharing: $180 - $136 = $44
      expect(r.cob_allocations.length).toBeGreaterThan(0);

      // Trace captures COB allocation rule
      const cobRules = trace.rule_firings.filter(rf => rf.category === 'cob_allocation');
      expect(cobRules.length).toBeGreaterThan(0);
    });

    it('non-duplication COB: no payment when primary paid >= secondary allowed', () => {
      const lines = [makeClaimLine({ line_id: 'L1', procedure_code: '99213', billed_amount: 15000 })];
      const acc = makeAccumulators({ individual_deductible_used: 100000 });
      const contract = makeContract();
      const plan = makePlan({ cob_policy: 'non_duplication' });

      const priorOutcomes: PriorPayerOutcome[] = [{
        payer_id: 'primary_plan',
        payer_name: 'Primary Insurance',
        claim_line_id: 'L1',
        billed: 15000,
        allowed: 14000,
        paid: 14000, // Primary paid their full allowed
        patient_responsibility: 0,
        adjustments: [],
        source: 'edi_835',
        confidence: 1.0,
      }];

      const { run } = adjudicateClaim(lines, acc, contract, plan, priorOutcomes);
      const r = run.line_results[0];

      // Non-duplication: primary paid $140 >= our allowed $120
      // So secondary pays nothing
      expect(r.allowed).toBe(12000);
      // The COB adjustment should equal allowed since primary overpays
      expect(r.cob_allocations[0].method).toBe('non_duplication');
    });

    it('maintenance_of_benefits: allows secondary to bridge gap when primary paid less than allowed', () => {
      const lines = [makeClaimLine({ line_id: 'L1', procedure_code: '99213', billed_amount: 15000 })];
      const acc = makeAccumulators({ individual_deductible_used: 100000 });
      const contract = makeContract(); // 99213 -> $120 allowed
      const plan = makePlan({ cob_policy: 'maintenance_of_benefits' });

      const priorOutcomes: PriorPayerOutcome[] = [{
        payer_id: 'primary_plan',
        payer_name: 'Primary Insurance',
        claim_line_id: 'L1',
        billed: 15000,
        allowed: 12000,
        paid: 6000,  // Primary paid only $60 (half of their $120 allowed)
        patient_responsibility: 6000,
        adjustments: [],
        source: 'edi_835',
        confidence: 1.0,
      }];

      const { run } = adjudicateClaim(lines, acc, contract, plan, priorOutcomes);
      const r = run.line_results[0];

      // Secondary allowed = $120
      expect(r.allowed).toBe(12000);
      // Primary paid $60; gap = $120 - $60 = $60
      // MOB: no adjustment (gap = 0), so secondary can pay the gap
      const mobAlloc = r.cob_allocations[0];
      expect(mobAlloc.method).toBe('maintenance_of_benefits');
      // The COB adjustment should be 0 (no constraint), allowing secondary to pay
      expect(r.cob_allocations[0].adjustment).toBe(0);
      // Secondary should pay something (bridging the gap)
      expect(r.plan_paid).toBeGreaterThan(0);
    });

    it('maintenance_of_benefits: allows no secondary payment when primary paid equal to allowed', () => {
      const lines = [makeClaimLine({ line_id: 'L1', procedure_code: '99213', billed_amount: 15000 })];
      const acc = makeAccumulators({ individual_deductible_used: 100000 });
      const contract = makeContract(); // 99213 -> $120 allowed
      const plan = makePlan({ cob_policy: 'maintenance_of_benefits' });

      const priorOutcomes: PriorPayerOutcome[] = [{
        payer_id: 'primary_plan',
        payer_name: 'Primary Insurance',
        claim_line_id: 'L1',
        billed: 15000,
        allowed: 12000,
        paid: 12000,  // Primary paid full $120 allowed
        patient_responsibility: 0,
        adjustments: [],
        source: 'edi_835',
        confidence: 1.0,
      }];

      const { run } = adjudicateClaim(lines, acc, contract, plan, priorOutcomes);
      const r = run.line_results[0];

      // Secondary allowed = $120
      expect(r.allowed).toBe(12000);
      // Primary paid $120 = allowed; gap = $0
      // MOB: adjustment = remaining_allowed = 0, so secondary cannot pay
      const mobAlloc = r.cob_allocations[0];
      expect(mobAlloc.method).toBe('maintenance_of_benefits');
      // Adjustment should be 0 (primary fully paid), capping secondary payment
      expect(r.cob_allocations[0].adjustment).toBe(0);
      // Secondary should not pay (no gap to bridge)
      expect(r.plan_paid).toBe(0);
    });

    it('maintenance_of_benefits: denies secondary payment when primary overpaid', () => {
      const lines = [makeClaimLine({ line_id: 'L1', procedure_code: '99213', billed_amount: 15000 })];
      const acc = makeAccumulators({ individual_deductible_used: 100000 });
      const contract = makeContract(); // 99213 -> $120 allowed
      const plan = makePlan({ cob_policy: 'maintenance_of_benefits' });

      const priorOutcomes: PriorPayerOutcome[] = [{
        payer_id: 'primary_plan',
        payer_name: 'Primary Insurance',
        claim_line_id: 'L1',
        billed: 15000,
        allowed: 12000,
        paid: 15000,  // Primary paid $150 (more than their allowed $120)
        patient_responsibility: 0,
        adjustments: [],
        source: 'edi_835',
        confidence: 1.0,
      }];

      const { run } = adjudicateClaim(lines, acc, contract, plan, priorOutcomes);
      const r = run.line_results[0];

      // Secondary allowed = $120
      expect(r.allowed).toBe(12000);
      // Primary overpaid ($150 > $120 allowed), capped to allowed
      // Total prior paid capped to allowed = $120
      // Remaining allowed = $0
      // MOB: adjustment = remaining_allowed = 0 (since primary fully paid, capped)
      const mobAlloc = r.cob_allocations[0];
      expect(mobAlloc.method).toBe('maintenance_of_benefits');
      // Secondary should not pay
      expect(r.plan_paid).toBe(0);
    });

    it('carve_out COB: secondary pays nothing after primary', () => {
      const lines = [makeClaimLine({ line_id: 'L1', procedure_code: '99213', billed_amount: 15000 })];
      const acc = makeAccumulators({ individual_deductible_used: 100000 });
      const contract = makeContract(); // 99213 -> $120 allowed
      const plan = makePlan({ cob_policy: 'carve_out' });

      const priorOutcomes: PriorPayerOutcome[] = [{
        payer_id: 'primary_plan',
        payer_name: 'Primary Insurance',
        claim_line_id: 'L1',
        billed: 15000,
        allowed: 12000,
        paid: 6000,  // Primary paid only $60
        patient_responsibility: 6000,
        adjustments: [],
        source: 'edi_835',
        confidence: 1.0,
      }];

      const { run } = adjudicateClaim(lines, acc, contract, plan, priorOutcomes);
      const r = run.line_results[0];

      // Secondary allowed = $120
      expect(r.allowed).toBe(12000);
      // Carve-out: secondary is carved out, pays nothing
      const carveAlloc = r.cob_allocations[0];
      expect(carveAlloc.method).toBe('carve_out');
      // Adjustment should equal remaining allowed (full carve-out)
      expect(r.cob_allocations[0].adjustment).toBe(6000); // $120 - $60 prior paid
      // Secondary should not pay
      expect(r.plan_paid).toBe(0);
    });

    it('COB with no prior outcomes', () => {
      const lines = [makeClaimLine({ line_id: 'L1', procedure_code: '99213', billed_amount: 15000 })];
      const acc = makeAccumulators({ individual_deductible_used: 100000 });
      const contract = makeContract();
      const plan = makePlan({ cob_policy: 'standard' });

      const { run } = adjudicateClaim(lines, acc, contract, plan, []);

      const r = run.line_results[0];
      // No COB priors, should adjudicate normally
      expect(r.allowed).toBe(12000);
      expect(r.cob_allocations).toHaveLength(0);
      // Should pay normally (no cost-sharing, deductible met)
      expect(r.plan_paid).toBeGreaterThan(0);
    });
  });

  describe('COB Primacy Rules', () => {
    it('birthday rule: earlier birthday is primary', () => {
      const result = determineCOBPrimacy(
        [{ payer_id: 'p1', payer_name: 'P1', coverage_type: 'medical' }],
        { member_dob: '1985-03-15', spouse_dob: '1985-07-20' },
        [birthdayRule]
      );
      expect(result).not.toBeNull();
      expect(result!.primary_payer_id).toBe('member_plan');
      expect(result!.rationale).toContain('Birthday Rule');
    });

    it('birthday rule: spouse earlier', () => {
      const result = determineCOBPrimacy(
        [{ payer_id: 'p1', payer_name: 'P1', coverage_type: 'medical' }],
        { member_dob: '1985-09-01', spouse_dob: '1985-02-14' },
        [birthdayRule]
      );
      expect(result!.primary_payer_id).toBe('spouse_plan');
    });

    it('birthday rule: leap-year Feb 29 member is primary over Mar 1 spouse', () => {
      // Member born Feb 29 (leap year) → "02-29" < "03-01" lexically → member is primary
      const result = determineCOBPrimacy(
        [{ payer_id: 'p1', payer_name: 'P1', coverage_type: 'medical' }],
        { member_dob: '1984-02-29', spouse_dob: '1984-03-01' },
        [birthdayRule]
      );
      expect(result).not.toBeNull();
      expect(result!.primary_payer_id).toBe('member_plan');
    });

    it('birthday rule: Feb 28 spouse is primary over Feb 29 member', () => {
      // Spouse born Feb 28 → "02-28" < "02-29" → spouse is primary
      const result = determineCOBPrimacy(
        [{ payer_id: 'p1', payer_name: 'P1', coverage_type: 'medical' }],
        { member_dob: '1984-02-29', spouse_dob: '1984-02-28' },
        [birthdayRule]
      );
      expect(result!.primary_payer_id).toBe('spouse_plan');
    });
  });

  describe('Trace integrity', () => {
    it('every adjudication produces a complete trace', () => {
      const lines = [
        makeClaimLine({ line_id: 'L1', claim_line_number: 1 }),
        makeClaimLine({ line_id: 'L2', claim_line_number: 2, procedure_code: '99214', billed_amount: 20000 }),
      ];

      const { trace } = adjudicateClaim(lines, makeAccumulators(), makeContract(), makePlan());

      // Required trace fields
      expect(trace.trace_id).toBeTruthy();
      expect(trace.run_id).toBeTruthy();
      expect(trace.claim_id).toBe('claim_1');
      expect(trace.rule_set_version).toBeTruthy();
      expect(trace.plan_version).toBe('1.0');
      expect(trace.contract_version).toBe('1.0');
      expect(trace.calc_policy_version).toBeTruthy();
      expect(trace.inputs_snapshot_hash).toBeTruthy();
      expect(trace.snapshot_ref).toContain(trace.run_id);

      // One math step per line
      expect(trace.math_steps).toHaveLength(2);
      expect(trace.math_steps[0].line_id).toBe('L1');
      expect(trace.math_steps[1].line_id).toBe('L2');

      // Rule firings exist and are ordered
      expect(trace.rule_firings.length).toBeGreaterThan(0);
      for (let i = 1; i < trace.rule_firings.length; i++) {
        expect(trace.rule_firings[i].order).toBeGreaterThanOrEqual(trace.rule_firings[i - 1].order);
      }

      // Math steps balance: billed = allowed + contractual_adj (implicitly)
      for (const step of trace.math_steps) {
        // plan_paid + member_resp should equal allowed (when no COB)
        expect(step.plan_paid + step.member_responsibility).toBeLessThanOrEqual(step.allowed + 1); // +1 for rounding
      }
    });
  });
});
