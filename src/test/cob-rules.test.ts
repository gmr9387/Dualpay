import { describe, it, expect } from 'vitest';
import {
  birthdayRule,
  lengthOfCoverageRule,
  determineCOBPrimacy,
  calculateCOBAllocation,
  type COBPrimacyRule,
  type PrimacyContext,
  type PrimacyResult,
} from '@/engine/cob-rules';
import type { OHIIndicator, PriorPayerOutcome } from '@/types/claim';
import type { RuleFiring } from '@/types/trace';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeIndicator(payerId: string): OHIIndicator {
  return { payer_id: payerId, payer_name: `Payer ${payerId}`, coverage_type: 'medical' };
}

function makePrior(payerId: string, paid: number, allowed: number): PriorPayerOutcome {
  return {
    payer_id: payerId,
    payer_name: `Payer ${payerId}`,
    claim_line_id: 'line_1',
    paid,
    allowed,
    adjustment: 0,
    copay: 0,
    coinsurance: 0,
    deductible: 0,
  };
}

// ---------------------------------------------------------------------------
// 1. Birthday Rule — Timezone-Safe Parsing
// ---------------------------------------------------------------------------

describe('Birthday Rule — Timezone-Safe Parsing', () => {
  it('member earlier in year → member plan is primary', () => {
    const ctx: PrimacyContext = {
      member_dob: '1985-03-10',
      spouse_dob:  '1985-09-22',
    };
    const result = birthdayRule.evaluate([], ctx);
    expect(result).not.toBeNull();
    expect(result!.primary_payer_id).toBe('member_plan');
    expect(result!.secondary_payer_id).toBe('spouse_plan');
  });

  it('spouse earlier in year → spouse plan is primary', () => {
    const ctx: PrimacyContext = {
      member_dob: '1985-11-01',
      spouse_dob:  '1985-02-14',
    };
    const result = birthdayRule.evaluate([], ctx);
    expect(result).not.toBeNull();
    expect(result!.primary_payer_id).toBe('spouse_plan');
    expect(result!.secondary_payer_id).toBe('member_plan');
  });

  it('identical birthdays → member plan is primary (tie goes to member)', () => {
    const ctx: PrimacyContext = {
      member_dob: '1985-06-15',
      spouse_dob:  '1990-06-15', // different year, same month-day
    };
    const result = birthdayRule.evaluate([], ctx);
    expect(result).not.toBeNull();
    // Both share MM-DD 06-15 → memberKey <= spouseKey → member primary
    expect(result!.primary_payer_id).toBe('member_plan');
  });

  it('leap year Feb 29 — member born Feb 29, spouse Feb 28 → member primary', () => {
    const ctx: PrimacyContext = {
      member_dob: '1988-02-29',
      spouse_dob:  '1990-02-28',
    };
    const result = birthdayRule.evaluate([], ctx);
    expect(result).not.toBeNull();
    // 02-28 < 02-29 → spouse earlier → spouse primary
    expect(result!.primary_payer_id).toBe('spouse_plan');
  });

  it('leap year Feb 29 vs Feb 29 → tie → member primary', () => {
    const ctx: PrimacyContext = {
      member_dob: '1988-02-29',
      spouse_dob:  '1992-02-29',
    };
    const result = birthdayRule.evaluate([], ctx);
    expect(result).not.toBeNull();
    expect(result!.primary_payer_id).toBe('member_plan');
  });

  it('Dec 31 vs Jan 1 → Jan 1 is earlier → spouse primary', () => {
    const ctx: PrimacyContext = {
      member_dob: '1985-12-31',
      spouse_dob:  '1985-01-01',
    };
    const result = birthdayRule.evaluate([], ctx);
    expect(result).not.toBeNull();
    expect(result!.primary_payer_id).toBe('spouse_plan');
  });

  it('returns null when member_dob missing', () => {
    const ctx: PrimacyContext = { spouse_dob: '1985-06-15' };
    expect(birthdayRule.evaluate([], ctx)).toBeNull();
  });

  it('returns null when spouse_dob missing', () => {
    const ctx: PrimacyContext = { member_dob: '1985-06-15' };
    expect(birthdayRule.evaluate([], ctx)).toBeNull();
  });

  it('returns null for invalid date format', () => {
    const ctx: PrimacyContext = {
      member_dob: 'not-a-date',
      spouse_dob: '1985-06-15',
    };
    expect(birthdayRule.evaluate([], ctx)).toBeNull();
  });

  it('is timezone-invariant — parses ISO string not Date object', () => {
    // Two contexts with the same DOBs but different representations
    // Both must yield the same result regardless of system timezone
    const ctx1: PrimacyContext = { member_dob: '1985-01-01', spouse_dob: '1985-12-31' };
    const ctx2: PrimacyContext = { member_dob: '1985-01-01T23:59:00Z', spouse_dob: '1985-12-31T00:00:00Z' };
    const r1 = birthdayRule.evaluate([], ctx1);
    const r2 = birthdayRule.evaluate([], ctx2);
    expect(r1?.primary_payer_id).toBe(r2?.primary_payer_id);
  });
});

// ---------------------------------------------------------------------------
// 2. Length of Coverage Rule
// ---------------------------------------------------------------------------

describe('Length of Coverage Rule', () => {
  it('two plans — earlier start date is primary', () => {
    const ctx: PrimacyContext = {
      coverage_start_dates: new Map([
        ['payer_a', '2022-01-01'],
        ['payer_b', '2023-06-01'],
      ]),
    };
    const result = lengthOfCoverageRule.evaluate([], ctx);
    expect(result).not.toBeNull();
    expect(result!.primary_payer_id).toBe('payer_a');
    expect(result!.secondary_payer_id).toBe('payer_b');
  });

  it('three plans — earliest is primary, second-earliest is secondary', () => {
    const ctx: PrimacyContext = {
      coverage_start_dates: new Map([
        ['payer_c', '2021-03-01'],
        ['payer_a', '2019-07-15'],
        ['payer_b', '2020-11-01'],
      ]),
    };
    const result = lengthOfCoverageRule.evaluate([], ctx);
    expect(result).not.toBeNull();
    expect(result!.primary_payer_id).toBe('payer_a');   // 2019
    expect(result!.secondary_payer_id).toBe('payer_b'); // 2020
  });

  it('single plan — returns null (no COB needed)', () => {
    const ctx: PrimacyContext = {
      coverage_start_dates: new Map([['payer_a', '2022-01-01']]),
    };
    expect(lengthOfCoverageRule.evaluate([], ctx)).toBeNull();
  });

  it('returns null when coverage_start_dates missing', () => {
    const ctx: PrimacyContext = {};
    expect(lengthOfCoverageRule.evaluate([], ctx)).toBeNull();
  });

  it('returns null when coverage_start_dates is empty', () => {
    const ctx: PrimacyContext = { coverage_start_dates: new Map() };
    expect(lengthOfCoverageRule.evaluate([], ctx)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. determineCOBPrimacy — Rule Priority & Trace
// ---------------------------------------------------------------------------

describe('determineCOBPrimacy — Rule Priority and Firing Trace', () => {
  it('fires lowest-priority-number rule first', () => {
    // Both rules can match; priority 10 (birthday) should fire before 20 (length)
    const ctx: PrimacyContext = {
      member_dob: '1985-03-10',
      spouse_dob: '1985-09-22',
      coverage_start_dates: new Map([
        ['payer_x', '2022-01-01'],
        ['payer_y', '2020-01-01'],
      ]),
    };
    const result = determineCOBPrimacy([], ctx);
    expect(result).not.toBeNull();
    expect(result!.rule_id).toBe('COB_BIRTHDAY_001');
  });

  it('falls through to next rule when first does not match', () => {
    // No DOBs → birthday rule returns null; length-of-coverage fires
    const ctx: PrimacyContext = {
      coverage_start_dates: new Map([
        ['payer_a', '2020-01-01'],
        ['payer_b', '2022-01-01'],
      ]),
    };
    const result = determineCOBPrimacy([], ctx);
    expect(result).not.toBeNull();
    expect(result!.rule_id).toBe('COB_LENGTH_001');
  });

  it('returns null when no rules match', () => {
    const ctx: PrimacyContext = {};
    expect(determineCOBPrimacy([], ctx)).toBeNull();
  });

  it('appends a RuleFiring entry on match', () => {
    const ctx: PrimacyContext = {
      member_dob: '1985-01-01',
      spouse_dob: '1985-12-31',
    };
    const firings: RuleFiring[] = [];
    determineCOBPrimacy([], ctx, undefined, firings);
    expect(firings.length).toBe(1);
    expect(firings[0].rule_id).toBe('COB_BIRTHDAY_001');
    expect(firings[0].category).toBe('cob_primacy');
  });

  it('supports custom rule packs', () => {
    const customRule: COBPrimacyRule = {
      rule_id: 'CUSTOM_001',
      name: 'Custom Rule',
      priority: 5,
      evaluate: (indicators) =>
        indicators.length > 0
          ? {
              primary_payer_id: indicators[0].payer_id,
              secondary_payer_id: indicators[1]?.payer_id ?? indicators[0].payer_id,
              rationale: 'custom',
              rule_id: 'CUSTOM_001',
            }
          : null,
    };
    const indicators = [makeIndicator('payer_a'), makeIndicator('payer_b')];
    const result = determineCOBPrimacy(indicators, {}, [customRule]);
    expect(result).not.toBeNull();
    expect(result!.rule_id).toBe('CUSTOM_001');
    expect(result!.primary_payer_id).toBe('payer_a');
  });
});

// ---------------------------------------------------------------------------
// 4. calculateCOBAllocation — COB Policies
// ---------------------------------------------------------------------------

describe('calculateCOBAllocation — Standard Policy', () => {
  it('no adjustment — secondary adjudicates remaining normally', () => {
    const prior = [makePrior('payer_a', 6000, 12000)];
    const result = calculateCOBAllocation(12000, prior, 'standard');
    expect(result.total_prior_paid).toBe(6000);
    expect(result.adjustment).toBe(0);
    expect(result.allocations.length).toBe(1);
    expect(result.allocations[0].method).toBe('standard');
  });

  it('adjustment is 0 when prior paid exceeds allowed', () => {
    const prior = [makePrior('payer_a', 15000, 12000)];
    const result = calculateCOBAllocation(12000, prior, 'standard');
    // total_prior_paid capped to allowed
    expect(result.total_prior_paid).toBe(12000);
    expect(result.adjustment).toBe(0);
  });
});

describe('calculateCOBAllocation — Non-Duplication Policy', () => {
  it('adjustment equals remaining allowed after prior payment', () => {
    const prior = [makePrior('payer_a', 6000, 12000)];
    const result = calculateCOBAllocation(12000, prior, 'non_duplication');
    expect(result.total_prior_paid).toBe(6000);
    // remainingAllowed = 12000 - 6000 = 6000 → adjustment = 6000
    expect(result.adjustment).toBe(6000);
  });

  it('adjustment is 0 when prior covered full allowed', () => {
    const prior = [makePrior('payer_a', 12000, 12000)];
    const result = calculateCOBAllocation(12000, prior, 'non_duplication');
    expect(result.total_prior_paid).toBe(12000);
    expect(result.adjustment).toBe(0);
  });
});

describe('calculateCOBAllocation — Carve-Out Policy', () => {
  it('secondary completely carved out — adjustment = remaining allowed', () => {
    const prior = [makePrior('payer_a', 6000, 12000)];
    const result = calculateCOBAllocation(12000, prior, 'carve_out');
    expect(result.total_prior_paid).toBe(6000);
    expect(result.adjustment).toBe(6000); // full remaining carved out
  });

  it('when primary paid full allowed — adjustment is 0 (nothing left to carve)', () => {
    const prior = [makePrior('payer_a', 12000, 12000)];
    const result = calculateCOBAllocation(12000, prior, 'carve_out');
    expect(result.adjustment).toBe(0);
  });

  it('zero prior paid — full allowed amount is the adjustment', () => {
    const result = calculateCOBAllocation(10000, [], 'carve_out');
    expect(result.total_prior_paid).toBe(0);
    expect(result.adjustment).toBe(10000);
  });
});

describe('calculateCOBAllocation — Maintenance of Benefits', () => {
  it('primary paid less than allowed — secondary may pay gap (adjustment = 0)', () => {
    const prior = [makePrior('payer_a', 6000, 12000)];
    const result = calculateCOBAllocation(12000, prior, 'maintenance_of_benefits');
    expect(result.total_prior_paid).toBe(6000);
    expect(result.adjustment).toBe(0); // no constraint, secondary can pay gap
  });

  it('primary paid equal to allowed — secondary pays nothing', () => {
    const prior = [makePrior('payer_a', 12000, 12000)];
    const result = calculateCOBAllocation(12000, prior, 'maintenance_of_benefits');
    // totalPriorPaid (12000) >= safeAllowed (12000) → adjustment = remainingAllowed (0)
    expect(result.adjustment).toBe(0);
  });

  it('primary overpaid — secondary pays nothing (capped)', () => {
    const prior = [makePrior('payer_a', 15000, 12000)];
    const result = calculateCOBAllocation(12000, prior, 'maintenance_of_benefits');
    expect(result.total_prior_paid).toBe(12000); // capped to allowed
    expect(result.adjustment).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Edge Cases
// ---------------------------------------------------------------------------

describe('calculateCOBAllocation — Edge Cases', () => {
  it('allowed = 0 → total_prior_paid = 0, adjustment = 0', () => {
    const prior = [makePrior('payer_a', 5000, 5000)];
    const result = calculateCOBAllocation(0, prior, 'standard');
    expect(result.total_prior_paid).toBe(0);
    expect(result.adjustment).toBe(0);
  });

  it('no prior outcomes → total_prior_paid = 0, no allocations', () => {
    const result = calculateCOBAllocation(10000, [], 'standard');
    expect(result.total_prior_paid).toBe(0);
    expect(result.allocations.length).toBe(0);
  });

  it('unknown policy type throws an explicit error', () => {
    expect(() =>
      calculateCOBAllocation(10000, [], 'unknown_policy' as never),
    ).toThrow('Unknown COB policy type');
  });

  it('error message for unknown policy names the valid types', () => {
    try {
      calculateCOBAllocation(10000, [], 'bad' as never);
    } catch (e) {
      expect(String(e)).toContain('standard');
      expect(String(e)).toContain('non_duplication');
      expect(String(e)).toContain('carve_out');
      expect(String(e)).toContain('maintenance_of_benefits');
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Multi-Payer Rounding — Largest-Remainder Distribution
// ---------------------------------------------------------------------------

describe('Multi-Payer Rounding — Largest-Remainder Distribution', () => {
  it('sum of allocations always equals total adjustment (3 payers, odd amount)', () => {
    const prior = [
      makePrior('payer_a', 6000, 12000),
      makePrior('payer_b', 2000, 12000),
      makePrior('payer_c', 2000, 12000),
    ];
    // Use non_duplication so there's a nonzero adjustment to distribute
    const result = calculateCOBAllocation(12000, prior, 'non_duplication');
    const allocationSum = result.allocations.reduce((s, a) => s + a.adjustment, 0);
    expect(allocationSum).toBe(result.adjustment);
  });

  it('proportional split preserves sum for arbitrary amounts', () => {
    // adjustment = 103, 3 payers with 60/20/20 weights → ideal 61.8 / 20.6 / 20.6
    const prior = [
      makePrior('payer_a', 600, 1000),
      makePrior('payer_b', 200, 1000),
      makePrior('payer_c', 200, 1000),
    ];
    const result = calculateCOBAllocation(1000, prior, 'non_duplication');
    const allocationSum = result.allocations.reduce((s, a) => s + a.adjustment, 0);
    expect(allocationSum).toBe(result.adjustment);
  });

  it('equal weights distribute evenly', () => {
    const prior = [
      makePrior('payer_a', 5000, 15000),
      makePrior('payer_b', 5000, 15000),
      makePrior('payer_c', 5000, 15000),
    ];
    const result = calculateCOBAllocation(15000, prior, 'non_duplication');
    const allocationSum = result.allocations.reduce((s, a) => s + a.adjustment, 0);
    expect(allocationSum).toBe(result.adjustment);
  });

  it('single payer gets entire adjustment', () => {
    const prior = [makePrior('payer_a', 4000, 10000)];
    const result = calculateCOBAllocation(10000, prior, 'non_duplication');
    expect(result.allocations[0].adjustment).toBe(result.adjustment);
  });
});

// ---------------------------------------------------------------------------
// 7. Primacy Output Validation
// ---------------------------------------------------------------------------

describe('Primacy Output Validation', () => {
  it('synthetic payer ids (member_plan, spouse_plan) pass validation', () => {
    const indicators = [makeIndicator('payer_a')];
    const ctx: PrimacyContext = {
      member_dob: '1985-01-01',
      spouse_dob: '1985-12-31',
    };
    // birthdayRule returns member_plan/spouse_plan which are synthetic — no throw
    expect(() => determineCOBPrimacy(indicators, ctx)).not.toThrow();
  });

  it('throws when custom rule returns a primary payer_id not in indicators', () => {
    const badRule: COBPrimacyRule = {
      rule_id: 'BAD_001',
      name: 'Bad Rule',
      priority: 1,
      evaluate: () => ({
        primary_payer_id: 'nonexistent_payer',
        secondary_payer_id: 'payer_a',
        rationale: 'bad',
        rule_id: 'BAD_001',
      }),
    };
    const indicators = [makeIndicator('payer_a'), makeIndicator('payer_b')];
    expect(() => determineCOBPrimacy(indicators, {}, [badRule])).toThrow(
      'invalid primary payer',
    );
  });

  it('throws when custom rule returns a secondary payer_id not in indicators', () => {
    const badRule: COBPrimacyRule = {
      rule_id: 'BAD_002',
      name: 'Bad Rule',
      priority: 1,
      evaluate: () => ({
        primary_payer_id: 'payer_a',
        secondary_payer_id: 'ghost_payer',
        rationale: 'bad',
        rule_id: 'BAD_002',
      }),
    };
    const indicators = [makeIndicator('payer_a'), makeIndicator('payer_b')];
    expect(() => determineCOBPrimacy(indicators, {}, [badRule])).toThrow(
      'invalid secondary payer',
    );
  });

  it('skips validation when indicators array is empty', () => {
    const anyRule: COBPrimacyRule = {
      rule_id: 'ANY_001',
      name: 'Any Rule',
      priority: 1,
      evaluate: () => ({
        primary_payer_id: 'totally_made_up',
        secondary_payer_id: 'also_made_up',
        rationale: 'no validation when no indicators',
        rule_id: 'ANY_001',
      }),
    };
    // Empty indicators → validation is skipped
    expect(() => determineCOBPrimacy([], {}, [anyRule])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. Public API surface (signature preservation)
// ---------------------------------------------------------------------------

describe('Public API surface', () => {
  it('birthdayRule is a COBPrimacyRule with the expected shape', () => {
    expect(birthdayRule.rule_id).toBe('COB_BIRTHDAY_001');
    expect(typeof birthdayRule.evaluate).toBe('function');
    expect(typeof birthdayRule.priority).toBe('number');
  });

  it('lengthOfCoverageRule is a COBPrimacyRule with the expected shape', () => {
    expect(lengthOfCoverageRule.rule_id).toBe('COB_LENGTH_001');
    expect(typeof lengthOfCoverageRule.evaluate).toBe('function');
  });

  it('calculateCOBAllocation returns the expected output shape', () => {
    const result = calculateCOBAllocation(10000, [], 'standard');
    expect(typeof result.total_prior_paid).toBe('number');
    expect(typeof result.adjustment).toBe('number');
    expect(Array.isArray(result.allocations)).toBe(true);
  });

  it('determineCOBPrimacy accepts custom rule packs and firings array', () => {
    const firings: RuleFiring[] = [];
    const result = determineCOBPrimacy([], {}, [], firings);
    expect(result).toBeNull();
    expect(firings.length).toBe(0);
  });
});
