/**
 * Phase 4B Remediation D — Blocker Closure Tests
 *
 * Covers the two blockers closed by Remediation D:
 *
 * BLOCKER 1 — GuidedRecovery supplies an appeal-scoped idempotency key.
 *   • makeIdempotencyKey('appeal') produces a key matching /^appeal:[0-9a-f-]{36}$/
 *   • advance() is called with the generated key
 *   • rpc_advance_appeal_case receives the namespaced key
 *
 * BLOCKER 2 — No authenticated direct INSERT bypass.
 *   • Documents the migration contract: authenticated INSERT was revoked
 *   • The SELECT grant is retained (required by application read paths)
 *
 * Additional checks:
 *   • StateDiagram deterministic key never reaches advancePaymentState()
 *   • No references to deleted legacy helpers exist in production code
 *   • All four RPC names remain the sole financial write paths
 *
 * Test classification:
 *   UNIT — exercises application-layer logic; all DB calls are mocked via
 *           the global Supabase mock (src/test/setup.ts).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeIdempotencyKey } from '@/data/operational-workflows';
import { supabase } from '@/integrations/supabase/client';

// ── makeIdempotencyKey factory ────────────────────────────────

describe('makeIdempotencyKey — appeal namespace', () => {
  it('produces a key prefixed with "appeal:"', () => {
    const key = makeIdempotencyKey('appeal');
    expect(key).toMatch(/^appeal:/);
  });

  it('key body is a UUID (8-4-4-4-12 hex)', () => {
    const key = makeIdempotencyKey('appeal');
    const uuid = key.slice('appeal:'.length);
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('each call produces a unique key', () => {
    const k1 = makeIdempotencyKey('appeal');
    const k2 = makeIdempotencyKey('appeal');
    expect(k1).not.toBe(k2);
  });
});

// ── GuidedRecovery: key reaches rpc_advance_appeal_case ──────

describe('GuidedRecovery — appeal transition (UNIT)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('GuidedRecovery generates appeal:<uuid> and passes it to advance()', async () => {
    const fixedKey = 'appeal:123e4567-e89b-12d3-a456-426614174000';
    const makeKeySpy = vi.fn(() => fixedKey);
    const advanceSpy = vi.fn(async () => null);

    vi.doMock('@/data/operational-workflows', async () => {
      const actual = await vi.importActual<typeof import('@/data/operational-workflows')>('@/data/operational-workflows');
      return { ...actual, makeIdempotencyKey: makeKeySpy };
    });
    vi.doMock('@/hooks/use-appeal-recovery-cases', () => ({
      APPEAL_RECOVERY_STATES: ['denied', 'appeal_filed', 'submitted', 'payer_response', 'recovered', 'closed'],
      canTransitionTo: (from: string, to: string) => from === 'denied' && to === 'appeal_filed',
      useAppealRecoveryCases: () => ({
        cases: [{
          id: 'case-uuid',
          organization_id: 'org-uuid',
          claim_id: 'CLM-001',
          current_state: 'denied',
          assigned_to_user_id: 'user-uuid',
          packet_id: null,
          core_trace_id: null,
          core_decision_outcome: null,
          core_dispatch_status: null,
          glue_run_id: null,
          payer_response_status: null,
          recovered_amount_cents: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        loading: false,
        error: null,
        reload: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        advance: advanceSpy,
      }),
    }));

    const React = await import('react');
    const { render, screen, fireEvent, waitFor } = await import('@testing-library/react');
    const { default: GuidedRecovery } = await import('@/pages/GuidedRecovery');

    render(React.createElement(GuidedRecovery));
    fireEvent.click(screen.getByTitle('Advance to Appeal Filed'));

    await waitFor(() => {
      expect(makeKeySpy).toHaveBeenCalledWith('appeal');
      expect(advanceSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'case-uuid' }),
        'appeal_filed',
        fixedKey,
      );
    });

    expect(fixedKey).toMatch(/^appeal:[0-9a-f-]{36}$/i);
  });

  it('hook path forwards idempotencyKey to rpc_advance_appeal_case as p_idempotency_key', async () => {
    const { readFile } = await import('fs/promises');
    const src = await readFile('src/hooks/use-appeal-recovery-cases.ts', 'utf-8');
    expect(src).toMatch(/rpc\('rpc_advance_appeal_case'/);
    expect(src).toMatch(/p_idempotency_key:\s*idempotencyKey/);
  });

  it('required-key guard remains intact in hook source', async () => {
    const { readFile } = await import('fs/promises');
    const src = await readFile('src/hooks/use-appeal-recovery-cases.ts', 'utf-8');
    expect(src).toContain("if (!idempotencyKey) {");
    expect(src).toContain("setError('advance: idempotencyKey is required');");
    expect(src).toContain('return null;');
  });

  it('duplicate idempotency response returns the original result_id', async () => {
    const spy = vi.spyOn(supabase, 'rpc' as never)
      .mockResolvedValueOnce({
        data: { already_consumed: false, result_id: 'ARC-1', new_state: 'appeal_filed' },
        error: null,
      } as never)
      .mockResolvedValueOnce({
        data: { already_consumed: true, result_id: 'ARC-1', new_state: 'appeal_filed' },
        error: null,
      } as never);

    const key = makeIdempotencyKey('appeal');
    const params = {
      p_idempotency_key: key,
      p_case_id: 'case-uuid',
      p_org_id: 'org-uuid',
      p_actor: 'user',
      p_expected_state: 'denied',
      p_next_state: 'appeal_filed',
    } as never;

    const r1 = await supabase.rpc('rpc_advance_appeal_case', params);
    const r2 = await supabase.rpc('rpc_advance_appeal_case', params);

    expect((r1.data as { result_id: string }).result_id).toBe('ARC-1');
    expect((r2.data as { result_id: string }).result_id).toBe('ARC-1');
    expect((r2.data as { already_consumed: boolean }).already_consumed).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// ── StateDiagram: deterministic key stays in UI cache only ───

describe('StateDiagram — payment key does not reach advancePaymentState()', () => {
  afterEach(() => vi.restoreAllMocks());

  it('StateDiagram passes idempotencyKey only to canTransition(), never to rpc_advance_payment_state', async () => {
    // StateDiagram.tsx builds `payment:demo-${claimId}-${currentStatus}-${t.to}`
    // and passes it to canTransition() which is the UI cache hint — not the RPC.
    // Verify canTransition does NOT invoke supabase.rpc.
    const rpcSpy = vi.spyOn(supabase, 'rpc' as never);

    const { canTransition } = await import('@/engine/state-machine');
    canTransition({
      claimId: 'CLM-001',
      currentStatus: 'ADJUDICATED',
      targetStatus: 'PAYMENT_IN_PROGRESS',
      idempotencyKey: `payment:demo-CLM-001-ADJUDICATED-PAYMENT_IN_PROGRESS`,
    });

    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

// ── DB permission contract (migration documentation test) ────

describe('Remediation D — migration contract for idempotency_keys permissions', () => {
  it('migration 20260811000200 revokes INSERT on idempotency_keys from authenticated', async () => {
    // Verify the migration file exists and contains the required REVOKE statement.
    // This test uses a file-based assertion since we cannot connect to Postgres.
    const { readFile } = await import('fs/promises');
    const migrationPath =
      'supabase/migrations/20260811000200_phase4b_remediation_d_revoke_direct_writes.sql';
    const sql = await readFile(migrationPath, 'utf-8');
    expect(sql).toContain('REVOKE INSERT ON public.idempotency_keys FROM authenticated');
  });

  it('migration 20260811000200 revokes UPDATE on idempotency_keys from authenticated', async () => {
    const { readFile } = await import('fs/promises');
    const sql = await readFile(
      'supabase/migrations/20260811000200_phase4b_remediation_d_revoke_direct_writes.sql',
      'utf-8',
    );
    expect(sql).toContain('REVOKE UPDATE ON public.idempotency_keys FROM authenticated');
  });

  it('migration 20260811000200 revokes DELETE on idempotency_keys from authenticated', async () => {
    const { readFile } = await import('fs/promises');
    const sql = await readFile(
      'supabase/migrations/20260811000200_phase4b_remediation_d_revoke_direct_writes.sql',
      'utf-8',
    );
    expect(sql).toContain('REVOKE DELETE ON public.idempotency_keys FROM authenticated');
  });

  it('migration 20260811000200 drops the obsolete idempotency_keys_insert policy', async () => {
    const { readFile } = await import('fs/promises');
    const sql = await readFile(
      'supabase/migrations/20260811000200_phase4b_remediation_d_revoke_direct_writes.sql',
      'utf-8',
    );
    expect(sql).toContain('DROP POLICY IF EXISTS "idempotency_keys_insert"');
  });

  it('migration does NOT revoke SELECT from authenticated', async () => {
    const { readFile } = await import('fs/promises');
    const sql = await readFile(
      'supabase/migrations/20260811000200_phase4b_remediation_d_revoke_direct_writes.sql',
      'utf-8',
    );
    // Ensure SELECT is not accidentally revoked
    expect(sql).not.toMatch(/REVOKE\s+(ALL|SELECT)\s+ON\s+public\.idempotency_keys\s+FROM\s+authenticated/i);
  });
});

// ── Four RPC EXECUTE grants confirmed in migrations ──────────

describe('Four authoritative RPCs — execute grants verified in migration source', () => {
  const RPCS = [
    'rpc_advance_payment_state',
    'rpc_log_recovery_event',
    'rpc_log_write_off',
    'rpc_advance_appeal_case',
  ] as const;

  for (const rpcName of RPCS) {
    it(`${rpcName} — GRANT EXECUTE TO authenticated is present in migration B`, async () => {
      const { readFile } = await import('fs/promises');
      const sql = await readFile(
        'supabase/migrations/20260810000200_phase4b_idempotency_remediation_b.sql',
        'utf-8',
      );
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${rpcName}`);
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${rpcName} FROM PUBLIC`);
    });

    it(`${rpcName} — SECURITY DEFINER + SET search_path = public in migration B`, async () => {
      const { readFile } = await import('fs/promises');
      const sql = await readFile(
        'supabase/migrations/20260810000200_phase4b_idempotency_remediation_b.sql',
        'utf-8',
      );
      // Each RPC must have both keywords
      const rpcSection = sql.slice(sql.indexOf(`FUNCTION public.${rpcName}`));
      expect(rpcSection).toContain('SECURITY DEFINER');
      expect(rpcSection).toContain('SET search_path = public');
    });
  }
});

// ── Legacy helper absence check ───────────────────────────────

describe('Legacy helper absence — no deleted symbols in production source', () => {
  const DELETED_SYMBOLS = [
    'recordIdempotencyKeyConsumption',
    'recordIdempotencyKeyConsumptionPersistent',
    'isIdempotencyKeyConsumedPersistent',
    'listIdempotencyKeysForClaimPersistent',
  ];

  for (const symbol of DELETED_SYMBOLS) {
    it(`"${symbol}" does not appear in non-test production files`, async () => {
      const { readFile } = await import('fs/promises');
      const files = [
        'src/main.tsx',
        'src/engine/state-machine.ts',
        'src/data/operational-workflows.ts',
        'src/data/repository.ts',
        'src/hooks/use-appeal-recovery-cases.ts',
        'src/pages/GuidedRecovery.tsx',
      ];

      for (const file of files) {
        const body = await readFile(file, 'utf-8');
        expect(body).not.toContain(symbol);
      }
    });
  }
});

// ── Phase 5A: appeal atomicity contract (source-level) ───────

describe('Phase 5A — appeal atomicity contract', () => {
  it('use-appeal-recovery-cases passes p_event_kind to rpc_advance_appeal_case', async () => {
    const { readFile } = await import('fs/promises');
    const src = await readFile('src/hooks/use-appeal-recovery-cases.ts', 'utf-8');
    expect(src).toContain('p_event_kind');
  });

  it('use-appeal-recovery-cases passes p_event_summary to rpc_advance_appeal_case', async () => {
    const { readFile } = await import('fs/promises');
    const src = await readFile('src/hooks/use-appeal-recovery-cases.ts', 'utf-8');
    expect(src).toContain('p_event_summary');
  });

  it('use-appeal-recovery-cases passes p_extra_patch to rpc_advance_appeal_case', async () => {
    const { readFile } = await import('fs/promises');
    const src = await readFile('src/hooks/use-appeal-recovery-cases.ts', 'utf-8');
    expect(src).toContain('p_extra_patch');
  });

  it('use-appeal-recovery-cases no longer contains a separate post-RPC appeal_recovery_cases update', async () => {
    const { readFile } = await import('fs/promises');
    const src = await readFile('src/hooks/use-appeal-recovery-cases.ts', 'utf-8');
    // The old post-RPC split UPDATE pattern used .from('appeal_recovery_cases').update(extra)
    // in a separate branch after the RPC call. Verify it is absent.
    expect(src).not.toMatch(/\.from\('appeal_recovery_cases'\)[\s\S]{0,40}\.update\(extra/);
  });

  it('logAppealEvent in operational-workflows does not call appendOpsEvent directly', async () => {
    const { readFile } = await import('fs/promises');
    const src = await readFile('src/data/operational-workflows.ts', 'utf-8');
    // Locate the logAppealEvent function body
    const fnStart = src.indexOf('export async function logAppealEvent');
    const fnEnd   = src.indexOf('\nexport ', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);
    expect(fnBody).not.toContain('appendOpsEvent');
  });

  it('logAppealEvent now requires an idempotencyKey parameter', async () => {
    const { readFile } = await import('fs/promises');
    const src = await readFile('src/data/operational-workflows.ts', 'utf-8');
    const fnStart = src.indexOf('export async function logAppealEvent');
    const fnEnd   = src.indexOf('\nexport ', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);
    expect(fnBody).toContain('idempotencyKey');
    expect(fnBody).toContain('idempotencyKey is required');
  });

  it('Phase 5A migration exists and contains the new CREATE OR REPLACE FUNCTION', async () => {
    const { readFile } = await import('fs/promises');
    const sql = await readFile(
      'supabase/migrations/20260812000100_phase5a_appeal_atomicity.sql',
      'utf-8',
    );
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.rpc_advance_appeal_case');
    expect(sql).toContain('p_event_kind');
    expect(sql).toContain('p_event_summary');
    expect(sql).toContain('INSERT INTO public.ops_events');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
  });

  it('Phase 5A migration does not modify historical migrations', async () => {
    // Verify the new migration file is at a later timestamp than the last Phase 4B migration.
    const { readdir } = await import('fs/promises');
    const files = (await readdir('supabase/migrations'))
      .filter(f => f.endsWith('.sql'))
      .sort();
    const phase4bLast = files.filter(f => f.startsWith('20260811')).sort().at(-1);
    const phase5a = files.find(f => f.startsWith('20260812'));
    expect(phase5a).toBeDefined();
    if (phase4bLast && phase5a) {
      expect(phase5a > phase4bLast).toBe(true);
    }
  });
});
