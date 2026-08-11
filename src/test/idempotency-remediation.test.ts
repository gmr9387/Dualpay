/**
 * Phase 4B Remediation A — Persistent Idempotency Tests
 *
 * Covers the remediated critical mutation paths:
 *   - logRecoveryEvent (via rpc_log_recovery_event)
 *   - logWriteOff (via rpc_log_write_off)
 *   - advancePaymentState (via rpc_advance_payment_state)
 *   - canTransition — in-memory UI cache behaviour preserved
 *
 * Test classification:
 *   UNIT — exercises application-layer logic with the global Supabase mock
 *           (set up in src/test/setup.ts). Uses vi.spyOn to control rpc()
 *           return values per test.
 *   DB   — requires a live PostgreSQL connection; marked describe.skip /
 *          NOT EXECUTED because the environment Supabase runtime is
 *          unavailable. Structured to run without modification once live.
 *
 * What the UNIT tests prove:
 *   • idempotencyKey is required (throws on missing / empty key)
 *   • correct RPC function name and parameters are sent
 *   • already_consumed path returns original result_id without a second call
 *     causing side-effects (application layer honours DB response)
 *   • error propagation: RPC errors surface to the caller
 *   • duplicate key call path: mock returns already_consumed = true,
 *     application returns original event_id
 *   • different keys produce independent calls
 *
 * What the UNIT tests do NOT prove (DB tests required):
 *   • actual uniqueness constraint enforced at the DB layer
 *   • concurrent duplicate requests — only one mutation committed
 *   • restart / cross-process recovery
 *   • cross-tenant rejection at the DB level
 *   • atomicity of mutation + idempotency record
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { supabase } from '@/integrations/supabase/client';

// ── helpers ───────────────────────────────────────────────────

function mockRpc(result: { data: unknown; error: null | { message: string } }) {
  return vi.spyOn(supabase, 'rpc' as never).mockResolvedValue(result as never);
}

// ── logRecoveryEvent (UNIT) ───────────────────────────────────

describe('logRecoveryEvent — UNIT', () => {
  afterEach(() => vi.restoreAllMocks());

  it('throws when idempotencyKey is missing', async () => {
    const { logRecoveryEvent } = await import('@/data/operational-workflows');
    await expect(
      logRecoveryEvent('CLM-001', 'org-uuid', {
        recoveryType: 'payer_payment',
        amountCents: 50000,
        recoveredFrom: 'Blue Cross',
        idempotencyKey: '',
      }),
    ).rejects.toThrow('idempotencyKey is required');
  });

  it('routes to rpc_log_recovery_event with correct parameters', async () => {
    const spy = mockRpc({ data: { already_consumed: false, event_id: 'EV-abc123' }, error: null });
    const { logRecoveryEvent } = await import('@/data/operational-workflows');

    const key = 'idem-recovery-001';
    const eventId = await logRecoveryEvent('CLM-001', 'org-uuid', {
      recoveryType: 'payer_payment',
      amountCents: 50000,
      recoveredFrom: 'Blue Cross',
      idempotencyKey: key,
    });

    expect(eventId).toBe('EV-abc123');
    expect(spy).toHaveBeenCalledWith(
      'rpc_log_recovery_event',
      expect.objectContaining({
        p_idempotency_key: key,
        p_claim_id: 'CLM-001',
        p_recovery_type: 'payer_payment',
        p_amount_cents: 50000,
      }),
    );
  });

  it('returns existing event_id on already_consumed (no second mutation)', async () => {
    const originalEventId = 'EV-original-999';
    const spy = mockRpc({ data: { already_consumed: true, event_id: originalEventId }, error: null });
    const { logRecoveryEvent } = await import('@/data/operational-workflows');

    const result = await logRecoveryEvent('CLM-001', 'org-uuid', {
      recoveryType: 'payer_payment',
      amountCents: 50000,
      recoveredFrom: 'Blue Cross',
      idempotencyKey: 'idem-already-used',
    });

    expect(result).toBe(originalEventId);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('propagates RPC error to caller', async () => {
    mockRpc({ data: null, error: { message: 'FORBIDDEN' } });
    const { logRecoveryEvent } = await import('@/data/operational-workflows');

    await expect(
      logRecoveryEvent('CLM-001', 'org-uuid', {
        recoveryType: 'payer_payment',
        amountCents: 50000,
        recoveredFrom: 'Blue Cross',
        idempotencyKey: 'idem-error-test',
      }),
    ).rejects.toBeTruthy();
  });

  it('duplicate call with same key returns original event_id (application honours DB response)', async () => {
    const spy = vi.spyOn(supabase, 'rpc' as never)
      .mockResolvedValueOnce({ data: { already_consumed: false, event_id: 'EV-first' }, error: null } as never)
      .mockResolvedValueOnce({ data: { already_consumed: true,  event_id: 'EV-first' }, error: null } as never);

    const { logRecoveryEvent } = await import('@/data/operational-workflows');
    const key = 'idem-recovery-dupe';

    const r1 = await logRecoveryEvent('CLM-001', 'org-uuid', {
      recoveryType: 'payer_payment', amountCents: 50000, recoveredFrom: 'Payer', idempotencyKey: key,
    });
    const r2 = await logRecoveryEvent('CLM-001', 'org-uuid', {
      recoveryType: 'payer_payment', amountCents: 50000, recoveredFrom: 'Payer', idempotencyKey: key,
    });

    expect(r1).toBe('EV-first');
    expect(r2).toBe('EV-first');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('different keys produce independent RPC calls', async () => {
    const spy = vi.spyOn(supabase, 'rpc' as never)
      .mockResolvedValueOnce({ data: { already_consumed: false, event_id: 'EV-A' }, error: null } as never)
      .mockResolvedValueOnce({ data: { already_consumed: false, event_id: 'EV-B' }, error: null } as never);

    const { logRecoveryEvent } = await import('@/data/operational-workflows');

    const rA = await logRecoveryEvent('CLM-001', 'org-uuid', {
      recoveryType: 'payer_payment', amountCents: 10000, recoveredFrom: 'Payer', idempotencyKey: 'idem-A',
    });
    const rB = await logRecoveryEvent('CLM-002', 'org-uuid', {
      recoveryType: 'payer_payment', amountCents: 20000, recoveredFrom: 'Payer', idempotencyKey: 'idem-B',
    });

    expect(rA).toBe('EV-A');
    expect(rB).toBe('EV-B');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// ── logWriteOff (UNIT) ────────────────────────────────────────

describe('logWriteOff — UNIT', () => {
  afterEach(() => vi.restoreAllMocks());

  it('throws when idempotencyKey is missing', async () => {
    const { logWriteOff } = await import('@/data/operational-workflows');
    await expect(
      logWriteOff('CLM-001', 'org-uuid', 'Timely filing exhausted', 'analyst-1', ''),
    ).rejects.toThrow('idempotencyKey is required');
  });

  it('routes to rpc_log_write_off with correct parameters', async () => {
    const spy = mockRpc({ data: { already_consumed: false, event_id: 'EV-wo-001' }, error: null });
    const { logWriteOff } = await import('@/data/operational-workflows');

    const key = 'idem-writeoff-001';
    const eventId = await logWriteOff('CLM-001', 'org-uuid', 'Uncollectable', 'analyst-1', key);

    expect(eventId).toBe('EV-wo-001');
    expect(spy).toHaveBeenCalledWith(
      'rpc_log_write_off',
      expect.objectContaining({
        p_idempotency_key: key,
        p_claim_id: 'CLM-001',
        p_reason: 'Uncollectable',
      }),
    );
  });

  it('returns original event_id when already consumed', async () => {
    mockRpc({ data: { already_consumed: true, event_id: 'EV-wo-original' }, error: null });
    const { logWriteOff } = await import('@/data/operational-workflows');
    const result = await logWriteOff('CLM-001', 'org-uuid', 'reason', 'actor', 'idem-wo-dupe');
    expect(result).toBe('EV-wo-original');
  });

  it('duplicate write-off returns same event_id, RPC called once per attempt', async () => {
    vi.spyOn(supabase, 'rpc' as never)
      .mockResolvedValueOnce({ data: { already_consumed: false, event_id: 'EV-first-wo' }, error: null } as never)
      .mockResolvedValueOnce({ data: { already_consumed: true,  event_id: 'EV-first-wo' }, error: null } as never);

    const { logWriteOff } = await import('@/data/operational-workflows');
    const key = 'idem-wo-idempotent';

    const r1 = await logWriteOff('CLM-001', 'org-uuid', 'reason', 'actor', key);
    const r2 = await logWriteOff('CLM-001', 'org-uuid', 'reason', 'actor', key);

    expect(r1).toBe('EV-first-wo');
    expect(r2).toBe('EV-first-wo');
  });
});

// ── advancePaymentState (UNIT) ────────────────────────────────

describe('advancePaymentState — UNIT', () => {
  afterEach(() => vi.restoreAllMocks());

  it('routes to rpc_advance_payment_state with correct parameters', async () => {
    const spy = mockRpc({
      data: { already_consumed: false, result_id: 'PAY-CLM-001-abc', new_status: 'PAYMENT_IN_PROGRESS' },
      error: null,
    });

    const { advancePaymentState } = await import('@/engine/state-machine');

    const result = await advancePaymentState({
      idempotencyKey: 'idem-pay-001',
      claimId: 'CLM-001',
      orgId: 'org-uuid',
      fromStatus: 'ADJUDICATED',
      toStatus: 'PAYMENT_IN_PROGRESS',
      actor: 'analyst-1',
    });

    expect(result.already_consumed).toBe(false);
    expect(result.new_status).toBe('PAYMENT_IN_PROGRESS');
    expect(spy).toHaveBeenCalledWith(
      'rpc_advance_payment_state',
      expect.objectContaining({
        p_idempotency_key: 'idem-pay-001',
        p_from_status: 'ADJUDICATED',
        p_to_status: 'PAYMENT_IN_PROGRESS',
      }),
    );
  });

  it('returns already_consumed result without duplicate mutation', async () => {
    mockRpc({
      data: { already_consumed: true, result_id: 'PAY-CLM-001-original', new_status: 'PAYMENT_IN_PROGRESS' },
      error: null,
    });

    const { advancePaymentState } = await import('@/engine/state-machine');
    const result = await advancePaymentState({
      idempotencyKey: 'idem-pay-consumed',
      claimId: 'CLM-001',
      orgId: 'org-uuid',
      fromStatus: 'ADJUDICATED',
      toStatus: 'PAYMENT_IN_PROGRESS',
      actor: 'analyst-1',
    });

    expect(result.already_consumed).toBe(true);
    expect(result.result_id).toBe('PAY-CLM-001-original');
  });

  it('propagates RPC error', async () => {
    mockRpc({ data: null, error: { message: 'STATE_CONFLICT' } });

    const { advancePaymentState } = await import('@/engine/state-machine');

    await expect(
      advancePaymentState({
        idempotencyKey: 'idem-pay-conflict',
        claimId: 'CLM-001',
        orgId: 'org-uuid',
        fromStatus: 'ADJUDICATED',
        toStatus: 'PAYMENT_IN_PROGRESS',
        actor: 'analyst-1',
      }),
    ).rejects.toBeTruthy();
  });
});

// ── advanceAppealCase (UNIT) ─────────────────────────────────
// Phase 5A: tests for the new single-authoritative appeal path.

describe('advanceAppealCase — UNIT', () => {
  afterEach(() => vi.restoreAllMocks());

  it('throws when idempotencyKey is missing', async () => {
    const { advanceAppealCase } = await import('@/data/operational-workflows');
    await expect(
      advanceAppealCase({
        idempotencyKey: '',
        orgId: 'org-uuid',
        eventKind: 'appeal_submitted',
        eventSummary: 'Appeal submitted',
        claimId: 'CLM-001',
      }),
    ).rejects.toThrow('idempotencyKey is required');
  });

  it('routes to rpc_advance_appeal_case with event metadata', async () => {
    const spy = mockRpc({
      data: {
        already_consumed: false,
        result_id: 'EV-ev-abc123',
        new_state: null,
        event_id: 'ev-abc123',
      },
      error: null,
    });
    const { advanceAppealCase } = await import('@/data/operational-workflows');

    const key = 'appeal:idem-advance-001';
    const result = await advanceAppealCase({
      idempotencyKey: key,
      orgId: 'org-uuid',
      eventKind: 'appeal_submitted',
      eventSummary: 'Appeal filed with Blue Cross',
      eventPayload: { appeal_status: 'pending_response' },
      claimId: 'CLM-001',
    });

    expect(result.alreadyConsumed).toBe(false);
    expect(result.resultId).toBe('EV-ev-abc123');
    expect(result.eventId).toBe('ev-abc123');
    expect(spy).toHaveBeenCalledWith(
      'rpc_advance_appeal_case',
      expect.objectContaining({
        p_idempotency_key: key,
        p_event_kind:      'appeal_submitted',
        p_event_summary:   'Appeal filed with Blue Cross',
        p_org_id:          'org-uuid',
        p_claim_id:        'CLM-001',
      }),
    );
  });

  it('passes case_id and next_state for state-transition path', async () => {
    const spy = mockRpc({
      data: {
        already_consumed: false,
        result_id: 'ARC-case-uuid-appeal_filed',
        new_state: 'appeal_filed',
        event_id: 'ev-xyz',
      },
      error: null,
    });
    const { advanceAppealCase } = await import('@/data/operational-workflows');

    const key = 'appeal:idem-transition-001';
    const result = await advanceAppealCase({
      idempotencyKey: key,
      caseId: 'case-uuid',
      orgId: 'org-uuid',
      expectedState: 'denied',
      nextState: 'appeal_filed',
      eventKind: 'appeal_submitted',
      eventSummary: 'Case advanced to appeal_filed',
      claimId: 'CLM-001',
    });

    expect(result.newState).toBe('appeal_filed');
    expect(result.resultId).toBe('ARC-case-uuid-appeal_filed');
    expect(spy).toHaveBeenCalledWith(
      'rpc_advance_appeal_case',
      expect.objectContaining({
        p_case_id:        'case-uuid',
        p_expected_state: 'denied',
        p_next_state:     'appeal_filed',
      }),
    );
  });

  it('returns already_consumed result without duplicate mutation', async () => {
    const originalResultId = 'ARC-case-uuid-original';
    mockRpc({
      data: {
        already_consumed: true,
        result_id: originalResultId,
        new_state: 'appeal_filed',
        event_id: null,
      },
      error: null,
    });
    const { advanceAppealCase } = await import('@/data/operational-workflows');

    const result = await advanceAppealCase({
      idempotencyKey: 'appeal:idem-consumed',
      caseId: 'case-uuid',
      orgId: 'org-uuid',
      expectedState: 'denied',
      nextState: 'appeal_filed',
      eventKind: 'appeal_submitted',
      eventSummary: 'Duplicate',
      claimId: 'CLM-001',
    });

    expect(result.alreadyConsumed).toBe(true);
    expect(result.resultId).toBe(originalResultId);
  });

  it('propagates RPC error to caller', async () => {
    mockRpc({ data: null, error: { message: 'FORBIDDEN' } });
    const { advanceAppealCase } = await import('@/data/operational-workflows');

    await expect(
      advanceAppealCase({
        idempotencyKey: 'appeal:idem-error',
        orgId: 'org-uuid',
        eventKind: 'appeal_submitted',
        eventSummary: 'Should fail',
        claimId: 'CLM-001',
      }),
    ).rejects.toBeTruthy();
  });

  it('duplicate call with same key returns original result_id (application honours DB response)', async () => {
    const spy = vi.spyOn(supabase, 'rpc' as never)
      .mockResolvedValueOnce({
        data: { already_consumed: false, result_id: 'ARC-first', new_state: 'appeal_filed', event_id: 'ev-1' },
        error: null,
      } as never)
      .mockResolvedValueOnce({
        data: { already_consumed: true, result_id: 'ARC-first', new_state: 'appeal_filed', event_id: null },
        error: null,
      } as never);

    const { advanceAppealCase } = await import('@/data/operational-workflows');
    const key = 'appeal:idem-dupe';

    const r1 = await advanceAppealCase({
      idempotencyKey: key, caseId: 'c', orgId: 'o',
      expectedState: 'denied', nextState: 'appeal_filed',
      eventKind: 'appeal_submitted', eventSummary: 'First', claimId: 'CLM-001',
    });
    const r2 = await advanceAppealCase({
      idempotencyKey: key, caseId: 'c', orgId: 'o',
      expectedState: 'denied', nextState: 'appeal_filed',
      eventKind: 'appeal_submitted', eventSummary: 'First', claimId: 'CLM-001',
    });

    expect(r1.resultId).toBe('ARC-first');
    expect(r2.resultId).toBe('ARC-first');
    expect(r2.alreadyConsumed).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('different keys produce independent RPC calls', async () => {
    const spy = vi.spyOn(supabase, 'rpc' as never)
      .mockResolvedValueOnce({
        data: { already_consumed: false, result_id: 'ARC-A', new_state: 'appeal_filed', event_id: 'ev-A' },
        error: null,
      } as never)
      .mockResolvedValueOnce({
        data: { already_consumed: false, result_id: 'ARC-B', new_state: 'submitted', event_id: 'ev-B' },
        error: null,
      } as never);

    const { advanceAppealCase } = await import('@/data/operational-workflows');

    const rA = await advanceAppealCase({
      idempotencyKey: 'appeal:idem-A', caseId: 'c1', orgId: 'o',
      expectedState: 'denied', nextState: 'appeal_filed',
      eventKind: 'appeal_submitted', eventSummary: 'A', claimId: 'CLM-001',
    });
    const rB = await advanceAppealCase({
      idempotencyKey: 'appeal:idem-B', caseId: 'c2', orgId: 'o',
      expectedState: 'appeal_filed', nextState: 'submitted',
      eventKind: 'appeal_responded', eventSummary: 'B', claimId: 'CLM-002',
    });

    expect(rA.resultId).toBe('ARC-A');
    expect(rB.resultId).toBe('ARC-B');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// ── logAppealEvent — routes through advanceAppealCase (UNIT) ──

describe('logAppealEvent — routes through advanceAppealCase (UNIT)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('throws when idempotencyKey is missing', async () => {
    const { logAppealEvent } = await import('@/data/operational-workflows');
    await expect(
      logAppealEvent('CLM-001', 'org-uuid', {
        kind: 'appeal_submitted',
        summary: 'Appeal',
        idempotencyKey: '',
      }),
    ).rejects.toThrow('idempotencyKey is required');
  });

  it('routes to rpc_advance_appeal_case with p_case_id = null', async () => {
    const spy = mockRpc({
      data: {
        already_consumed: false,
        result_id: 'EV-ev-log-001',
        new_state: null,
        event_id: 'ev-log-001',
      },
      error: null,
    });
    const { logAppealEvent } = await import('@/data/operational-workflows');

    const eventId = await logAppealEvent('CLM-001', 'org-uuid', {
      kind: 'appeal_submitted',
      summary: 'Appeal filed',
      appealStatus: 'pending_response',
      idempotencyKey: 'appeal:idem-log-001',
    });

    expect(eventId).toBe('EV-ev-log-001');
    expect(spy).toHaveBeenCalledWith(
      'rpc_advance_appeal_case',
      expect.objectContaining({
        p_idempotency_key: 'appeal:idem-log-001',
        p_case_id:         null,
        p_event_kind:      'appeal_submitted',
        p_event_summary:   'Appeal filed',
        p_claim_id:        'CLM-001',
      }),
    );
  });

  it('does NOT call appendOpsEvent directly (no direct ops_events insert)', async () => {
    // Verify at source level that logAppealEvent delegates to advanceAppealCase,
    // not appendOpsEvent.
    const { readFile } = await import('fs/promises');
    const src = await readFile('src/data/operational-workflows.ts', 'utf-8');

    // logAppealEvent body must reference advanceAppealCase
    const fnStart = src.indexOf('export async function logAppealEvent');
    const fnEnd   = src.indexOf('\nexport ', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);

    expect(fnBody).toContain('advanceAppealCase');
    expect(fnBody).not.toContain('appendOpsEvent');
  });
});

// ── canTransition — in-memory UI cache (UNIT) ─────────────────

describe('canTransition — in-memory UI cache (UNIT)', () => {
  beforeEach(async () => {
    const { clearIdempotencyKeysForDev } = await import('@/engine/state-machine');
    clearIdempotencyKeysForDev();
  });

  it('allows payment transition with a fresh idempotency key', async () => {
    const { canTransition } = await import('@/engine/state-machine');
    const result = canTransition({
      claimId: 'CLM-001',
      currentStatus: 'ADJUDICATED',
      targetStatus: 'PAYMENT_IN_PROGRESS',
      idempotencyKey: 'idem-fresh-ui',
    });
    expect(result.allowed).toBe(true);
  });

  it('reflects locally-consumed key in UI cache (hint only — not DB authority)', async () => {
    const { canTransition, consumeIdempotencyKey } = await import('@/engine/state-machine');
    consumeIdempotencyKey('idem-local-001');

    const result = canTransition({
      claimId: 'CLM-001',
      currentStatus: 'ADJUDICATED',
      targetStatus: 'PAYMENT_IN_PROGRESS',
      idempotencyKey: 'idem-local-001',
    });
    expect(result.failedGuards).toContain('IDEMPOTENCY_KEY_ALREADY_USED');
  });

  it('different keys are independent in the UI cache', async () => {
    const { canTransition, consumeIdempotencyKey } = await import('@/engine/state-machine');
    consumeIdempotencyKey('idem-A');

    const result = canTransition({
      claimId: 'CLM-001',
      currentStatus: 'ADJUDICATED',
      targetStatus: 'PAYMENT_IN_PROGRESS',
      idempotencyKey: 'idem-B',
    });
    expect(result.allowed).toBe(true);
  });
});

// ── DB TESTS — NOT EXECUTED (environment Supabase/Postgres unavailable) ──────
//
// These are structured DB/concurrency specifications for Phase 4B/5A.
// They intentionally remain skipped in this environment and must be run against
// a live PostgreSQL/Supabase runtime.

describe.skip('DB — rpc_advance_payment_state — first-use reservation (NOT EXECUTED)', () => {
  it('first request succeeds and writes one transition', async () => {});
  it('sequential duplicate with same key returns original result_id', async () => {});
  it('concurrent same-key requests return same result_id with no unique_violation surfaced', async () => {});
  it('exactly one payment status mutation is committed under concurrent same-key calls', async () => {});
  it('same key with different payload is rejected', async () => {});
  it('same key with different operation is rejected', async () => {});
  it('rollback after reservation does not leave key stuck; retry succeeds', async () => {});
  it('cross-tenant key reuse is rejected', async () => {});
  it('unauthorized caller cannot read another tenant idempotent result', async () => {});
});

describe.skip('DB — rpc_log_recovery_event — first-use reservation (NOT EXECUTED)', () => {
  it('first request succeeds and creates one recovery event', async () => {});
  it('sequential duplicate with same key returns original event_id', async () => {});
  it('concurrent same-key requests return same event_id', async () => {});
  it('exactly one ops_event row is created for concurrent same-key calls', async () => {});
  it('recovery aggregate increments exactly once for concurrent same-key calls', async () => {});
  it('same key with different payload is rejected', async () => {});
  it('same key with different operation is rejected', async () => {});
  it('rollback after reservation does not leave key stuck; retry succeeds', async () => {});
  it('cross-tenant key reuse is rejected', async () => {});
  it('unauthorized caller cannot read another tenant idempotent result', async () => {});
});

describe.skip('DB — rpc_log_write_off — first-use reservation (NOT EXECUTED)', () => {
  it('first request succeeds and creates one write-off event', async () => {});
  it('sequential duplicate with same key returns original event_id', async () => {});
  it('concurrent same-key requests return same event_id', async () => {});
  it('exactly one claim_written_off ops_event row is committed', async () => {});
  it('same key with different payload is rejected', async () => {});
  it('same key with different operation is rejected', async () => {});
  it('rollback after reservation does not leave key stuck; retry succeeds', async () => {});
  it('cross-tenant key reuse is rejected', async () => {});
  it('unauthorized caller cannot read another tenant idempotent result', async () => {});
});

// Phase 5A: rpc_advance_appeal_case now atomically performs:
//   idempotency reservation → state advance → extra_patch → ops_events INSERT → result commit.
// The UNIT tests above cover the application-layer contract.
// These DB tests specify the behaviour that must hold at the PostgreSQL layer and remain
// skipped until a live Supabase/Postgres connection is available.
describe.skip('DB — rpc_advance_appeal_case — first-use reservation (NOT EXECUTED)', () => {
  // Requires: appeal_recovery_cases row in state 'denied', valid org + user session.
  it('first request succeeds and performs one optimistic transition', async () => {
    // Assert: appeal_recovery_cases.current_state updated to p_next_state.
    // Assert: exactly one ops_events row with matching kind / claim_id / org_id.
    // Assert: idempotency_keys row with result_id set.
    // Assert: return { already_consumed: false, result_id, new_state, event_id }.
  });
  it('sequential duplicate with same key returns original result_id', async () => {
    // Assert: second call with same key returns { already_consumed: true, same result_id }.
    // Assert: no second ops_events row created.
    // Assert: appeal_recovery_cases.current_state unchanged (already advanced).
  });
  it('concurrent same-key requests return same result_id', async () => {
    // Requires two concurrent Postgres sessions.
    // Assert: exactly one of them commits the reservation; the other returns already_consumed.
  });
  it('exactly one state transition is committed under concurrent same-key calls', async () => {
    // Assert: COUNT(*) FROM appeal_recovery_cases WHERE id = p_case_id is 1 row.
    // Assert: current_state = p_next_state (not still in p_expected_state).
  });
  it('exactly one ops_events row is created for concurrent same-key calls', async () => {
    // Assert: COUNT(*) FROM ops_events WHERE ... = 1.
  });
  it('stale/different expected state remains rejected', async () => {
    // Assert: STATE_CONFLICT exception when case is already in p_next_state.
  });
  it('same key with different payload is rejected', async () => {
    // Assert: IDEMPOTENCY_CONFLICT exception.
  });
  it('same key with different operation is rejected', async () => {
    // Assert: IDEMPOTENCY_CONFLICT exception.
  });
  it('rollback after reservation does not leave key stuck; retry succeeds', async () => {
    // Force transaction abort after reservation but before commit.
    // Assert: idempotency_keys row with result_id IS NULL is rolled back.
    // Assert: retry with same key executes mutation successfully.
  });
  it('cross-tenant key reuse is rejected', async () => {
    // Assert: FORBIDDEN exception when p_org_id differs from original key org_id.
  });
  it('unauthorized caller cannot read another tenant idempotent result', async () => {
    // Assert: FORBIDDEN exception when caller is not an org member.
  });
  it('p_extra_patch columns are applied atomically with state transition', async () => {
    // Assert: recovered_amount_cents updated in same transaction as current_state.
    // Assert: if transaction is aborted, neither state nor patch is committed.
  });
  it('event-only path (p_case_id NULL) creates ops_events without touching appeal_recovery_cases', async () => {
    // Assert: ops_events row created.
    // Assert: appeal_recovery_cases unchanged.
    // Assert: result_id starts with "EV-".
  });
});
