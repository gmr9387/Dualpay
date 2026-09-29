/**
 * Guided Recovery — smoke tests for appeal_recovery_cases logic layer.
 *
 * These tests cover:
 *  1. canTransitionTo() — valid and invalid state transitions
 *  2. Full happy-path lifecycle: denied → appeal_filed → submitted →
 *     payer_response → recovered → closed
 *  3. Duplicate-entry guard (unique org+claim)
 *  4. Recovery amount accumulation
 *  5. Terminal-state guard (no transitions out of 'closed')
 */
import { describe, it, expect } from 'vitest';
import {
  canTransitionTo,
  APPEAL_RECOVERY_STATES,
  type AppealRecoveryState,
  type AppealRecoveryCase,
} from '@/hooks/use-appeal-recovery-cases';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCase(overrides: Partial<AppealRecoveryCase> = {}): AppealRecoveryCase {
  return {
    id: 'arc-test-001',
    organization_id: 'org-test-001',
    claim_id: 'CLM-SMOKE-001',
    current_state: 'denied',
    assigned_to_user_id: null,
    packet_id: null,
    core_trace_id: null,
    core_decision_outcome: null,
    core_dispatch_status: null,
    glue_run_id: null,
    payer_response_status: null,
    recovered_amount_cents: 0,
    servicenow_sys_id: null,
    servicenow_number: null,
    servicenow_sync_status: 'pending',
    servicenow_synced_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Simulate advancing a case's state in memory (mirrors the advance() logic
 * in use-appeal-recovery-cases without needing a Supabase connection).
 */
function applyTransition(
  arc: AppealRecoveryCase,
  next: AppealRecoveryState,
  extra: Partial<AppealRecoveryCase> = {}
): { ok: true; case: AppealRecoveryCase } | { ok: false; error: string } {
  if (!canTransitionTo(arc.current_state as AppealRecoveryState, next)) {
    return { ok: false, error: `Cannot transition ${arc.current_state} → ${next}` };
  }
  return {
    ok: true,
    case: { ...arc, current_state: next, updated_at: new Date().toISOString(), ...extra },
  };
}

// ---------------------------------------------------------------------------
// 1. canTransitionTo
// ---------------------------------------------------------------------------

describe('canTransitionTo — valid forward transitions', () => {
  it('denied → appeal_filed', () => {
    expect(canTransitionTo('denied', 'appeal_filed')).toBe(true);
  });
  it('appeal_filed → submitted', () => {
    expect(canTransitionTo('appeal_filed', 'submitted')).toBe(true);
  });
  it('submitted → payer_response', () => {
    expect(canTransitionTo('submitted', 'payer_response')).toBe(true);
  });
  it('payer_response → recovered', () => {
    expect(canTransitionTo('payer_response', 'recovered')).toBe(true);
  });
  it('payer_response → closed (unfavorable)', () => {
    expect(canTransitionTo('payer_response', 'closed')).toBe(true);
  });
  it('recovered → closed', () => {
    expect(canTransitionTo('recovered', 'closed')).toBe(true);
  });
});

describe('canTransitionTo — valid backward / retry transitions', () => {
  it('appeal_filed → denied (retract)', () => {
    expect(canTransitionTo('appeal_filed', 'denied')).toBe(true);
  });
  it('submitted → appeal_filed (rework)', () => {
    expect(canTransitionTo('submitted', 'appeal_filed')).toBe(true);
  });
  it('payer_response → submitted (re-submit)', () => {
    expect(canTransitionTo('payer_response', 'submitted')).toBe(true);
  });
});

describe('canTransitionTo — invalid transitions', () => {
  it('denied → submitted (skip step)', () => {
    expect(canTransitionTo('denied', 'submitted')).toBe(false);
  });
  it('denied → recovered (skip all)', () => {
    expect(canTransitionTo('denied', 'recovered')).toBe(false);
  });
  it('recovered → denied (cannot go back from terminal)', () => {
    expect(canTransitionTo('recovered', 'denied')).toBe(false);
  });
  it('closed → any (terminal state)', () => {
    for (const s of APPEAL_RECOVERY_STATES) {
      expect(canTransitionTo('closed', s)).toBe(false);
    }
  });
  it('submitted → recovered (skip payer_response)', () => {
    expect(canTransitionTo('submitted', 'recovered')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Full happy-path lifecycle
// ---------------------------------------------------------------------------

describe('Happy-path lifecycle', () => {
  it('advances all the way from denied to closed via recovered', () => {
    let arc = makeCase();

    // denied → appeal_filed
    let r = applyTransition(arc, 'appeal_filed');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error((r as { ok: false; error: string }).error);
    arc = r.case;
    expect(arc.current_state).toBe('appeal_filed');

    // appeal_filed → submitted
    r = applyTransition(arc, 'submitted');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error((r as { ok: false; error: string }).error);
    arc = r.case;
    expect(arc.current_state).toBe('submitted');

    // submitted → payer_response
    r = applyTransition(arc, 'payer_response', { payer_response_status: 'under_review' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error((r as { ok: false; error: string }).error);
    arc = r.case;
    expect(arc.current_state).toBe('payer_response');
    expect(arc.payer_response_status).toBe('under_review');

    // payer_response → recovered
    r = applyTransition(arc, 'recovered', { recovered_amount_cents: 85000 });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error((r as { ok: false; error: string }).error);
    arc = r.case;
    expect(arc.current_state).toBe('recovered');
    expect(arc.recovered_amount_cents).toBe(85000);

    // recovered → closed
    r = applyTransition(arc, 'closed');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error((r as { ok: false; error: string }).error);
    arc = r.case;
    expect(arc.current_state).toBe('closed');
  });

  it('advances denied → payer_response → closed (unfavorable path)', () => {
    let arc = makeCase();
    arc = (applyTransition(arc, 'appeal_filed') as { ok: true; case: AppealRecoveryCase }).case;
    arc = (applyTransition(arc, 'submitted') as { ok: true; case: AppealRecoveryCase }).case;
    arc = (applyTransition(arc, 'payer_response') as { ok: true; case: AppealRecoveryCase }).case;
    const r = applyTransition(arc, 'closed');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error((r as { ok: false; error: string }).error);
    expect(r.case.current_state).toBe('closed');
    expect(r.case.recovered_amount_cents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Duplicate-entry guard (unique org + claim)
// ---------------------------------------------------------------------------

describe('Unique org + claim constraint', () => {
  it('two different claims in the same org have different keys', () => {
    const a = makeCase({ claim_id: 'CLM-001' });
    const b = makeCase({ claim_id: 'CLM-002' });
    const keyA = `${a.organization_id}::${a.claim_id}`;
    const keyB = `${b.organization_id}::${b.claim_id}`;
    expect(keyA).not.toBe(keyB);
  });

  it('same claim in different orgs have different keys', () => {
    const a = makeCase({ organization_id: 'org-001', claim_id: 'CLM-001' });
    const b = makeCase({ organization_id: 'org-002', claim_id: 'CLM-001' });
    const keyA = `${a.organization_id}::${a.claim_id}`;
    const keyB = `${b.organization_id}::${b.claim_id}`;
    expect(keyA).not.toBe(keyB);
  });

  it('identical org + claim produces the same key (would be rejected by DB UNIQUE)', () => {
    const a = makeCase({ organization_id: 'org-001', claim_id: 'CLM-001' });
    const b = makeCase({ organization_id: 'org-001', claim_id: 'CLM-001' });
    const keyA = `${a.organization_id}::${a.claim_id}`;
    const keyB = `${b.organization_id}::${b.claim_id}`;
    expect(keyA).toBe(keyB);
  });
});

// ---------------------------------------------------------------------------
// 4. Recovery amount accumulation
// ---------------------------------------------------------------------------

describe('Recovery amount', () => {
  it('starts at 0', () => {
    const arc = makeCase();
    expect(arc.recovered_amount_cents).toBe(0);
  });

  it('records recovered amount when transitioning to recovered', () => {
    let arc = makeCase();
    arc = (applyTransition(arc, 'appeal_filed') as { ok: true; case: AppealRecoveryCase }).case;
    arc = (applyTransition(arc, 'submitted') as { ok: true; case: AppealRecoveryCase }).case;
    arc = (applyTransition(arc, 'payer_response') as { ok: true; case: AppealRecoveryCase }).case;
    const r = applyTransition(arc, 'recovered', { recovered_amount_cents: 123456 });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error((r as { ok: false; error: string }).error);
    expect(r.case.recovered_amount_cents).toBe(123456);
  });

  it('total recovered across multiple cases sums correctly', () => {
    const cases: AppealRecoveryCase[] = [
      makeCase({ id: '1', recovered_amount_cents: 10000 }),
      makeCase({ id: '2', recovered_amount_cents: 25000 }),
      makeCase({ id: '3', recovered_amount_cents: 0 }),
    ];
    const total = cases.reduce((s, c) => s + c.recovered_amount_cents, 0);
    expect(total).toBe(35000);
  });
});

// ---------------------------------------------------------------------------
// 5. Terminal-state guard
// ---------------------------------------------------------------------------

describe('Terminal state — closed', () => {
  it('cannot advance out of closed', () => {
    const arc = makeCase({ current_state: 'closed' });
    for (const s of APPEAL_RECOVERY_STATES) {
      const r = applyTransition(arc, s);
      expect(r.ok).toBe(false);
    }
  });

  it('cannot advance out of recovered except to closed', () => {
    const arc = makeCase({ current_state: 'recovered' });
    const nonClosed = APPEAL_RECOVERY_STATES.filter(s => s !== 'closed');
    for (const s of nonClosed) {
      const r = applyTransition(arc, s);
      expect(r.ok).toBe(false);
    }
    expect(applyTransition(arc, 'closed').ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. APPEAL_RECOVERY_STATES ordering sanity
// ---------------------------------------------------------------------------

describe('APPEAL_RECOVERY_STATES constant', () => {
  it('contains all expected states', () => {
    const expected: AppealRecoveryState[] = [
      'denied', 'appeal_filed', 'submitted', 'payer_response', 'recovered', 'closed',
    ];
    expect(APPEAL_RECOVERY_STATES).toEqual(expected);
  });

  it('has no duplicates', () => {
    expect(new Set(APPEAL_RECOVERY_STATES).size).toBe(APPEAL_RECOVERY_STATES.length);
  });
});
