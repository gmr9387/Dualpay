/**
 * Scheduler dispatcher behavior tests.
 *
 * These are unit-level tests that exercise the scheduler's contract without a
 * live Supabase instance.  They prove three things:
 *
 *  1. A successful worker invocation produces a completed scheduler run.
 *  2. A failed worker invocation produces a failed scheduler run.
 *  3. Scheduler errors (network / non-2xx) are NOT silently recorded as success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal inline re-implementation of the scheduler dispatcher logic so we
// can test the state-machine without a live Supabase / Deno environment.
// ---------------------------------------------------------------------------

interface SchedulerRunUpdate {
  status: string;
  completed_at: string;
  jobs_discovered: number;
  jobs_executed: number;
  notes: string | null;
}

interface OpsEventInsert {
  kind: string;
  summary: string;
  payload: Record<string, unknown>;
}

/**
 * Core scheduler logic extracted from the Edge Function so it can be unit-
 * tested.  The caller supplies injectable fetch + database stubs.
 */
async function runScheduler(opts: {
  queuedCount: number;
  fetchWorker: () => Promise<{ ok: boolean; status: number; body: unknown }>;
}): Promise<{
  runUpdate: SchedulerRunUpdate;
  finalEvent: OpsEventInsert;
  httpStatus: number;
}> {
  const queued = opts.queuedCount;

  let executed = 0;
  let workerError: string | null = null;
  let workerHttpStatus: number | null = null;

  try {
    const resp = await opts.fetchWorker();
    workerHttpStatus = resp.status;
    const body = resp.body as Record<string, unknown>;
    if (!resp.ok) {
      workerError = `worker-dispatcher returned HTTP ${resp.status}: ${body?.error ?? JSON.stringify(body)}`;
    } else {
      executed = (body?.executed as number) ?? 0;
    }
  } catch (err: unknown) {
    workerError = err instanceof Error ? err.message : String(err);
  }

  const finalStatus = workerError ? 'failed' : 'completed';
  const notes = workerError
    ? `worker invocation failed — http_status=${workerHttpStatus ?? 'network_error'} error=${workerError}`
    : null;

  const runUpdate: SchedulerRunUpdate = {
    status: finalStatus,
    completed_at: new Date().toISOString(),
    jobs_discovered: queued,
    jobs_executed: executed,
    notes,
  };

  const finalEvent: OpsEventInsert = {
    kind: workerError ? 'scheduler_failed' : 'scheduler_completed',
    summary: workerError
      ? `Scheduler failed — ${workerError}`
      : `Scheduler completed — discovered ${queued}, executed ${executed}`,
    payload: { discovered: queued, executed, error: workerError, http_status: workerHttpStatus },
  };

  const httpStatus = workerError ? 500 : 200;
  return { runUpdate, finalEvent, httpStatus };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduler-dispatcher — state machine', () => {
  it('1. successful worker invocation → status=completed, no notes', async () => {
    const result = await runScheduler({
      queuedCount: 5,
      fetchWorker: async () => ({ ok: true, status: 200, body: { executed: 4 } }),
    });

    expect(result.runUpdate.status).toBe('completed');
    expect(result.runUpdate.jobs_discovered).toBe(5);
    expect(result.runUpdate.jobs_executed).toBe(4);
    expect(result.runUpdate.notes).toBeNull();
    expect(result.finalEvent.kind).toBe('scheduler_completed');
    expect(result.httpStatus).toBe(200);
  });

  it('2. worker returns HTTP 500 → status=failed, notes contain error', async () => {
    const result = await runScheduler({
      queuedCount: 3,
      fetchWorker: async () => ({ ok: false, status: 500, body: { error: 'internal error' } }),
    });

    expect(result.runUpdate.status).toBe('failed');
    expect(result.runUpdate.jobs_executed).toBe(0);
    expect(result.runUpdate.notes).toContain('HTTP 500');
    expect(result.runUpdate.notes).toContain('internal error');
    expect(result.finalEvent.kind).toBe('scheduler_failed');
    expect(result.httpStatus).toBe(500);
  });

  it('3. network failure → status=failed, NOT silently completed', async () => {
    const result = await runScheduler({
      queuedCount: 2,
      fetchWorker: async () => { throw new Error('fetch failed: connection refused'); },
    });

    expect(result.runUpdate.status).toBe('failed');
    expect(result.runUpdate.status).not.toBe('completed');
    expect(result.runUpdate.notes).toContain('connection refused');
    expect(result.runUpdate.notes).toContain('network_error');
    expect(result.finalEvent.kind).toBe('scheduler_failed');
    expect(result.finalEvent.summary).toContain('failed');
    expect(result.httpStatus).toBe(500);
  });

  it('4. worker returns HTTP 401 → status=failed (auth failure not swallowed)', async () => {
    const result = await runScheduler({
      queuedCount: 1,
      fetchWorker: async () => ({ ok: false, status: 401, body: {} }),
    });

    expect(result.runUpdate.status).toBe('failed');
    expect(result.runUpdate.notes).toContain('HTTP 401');
    expect(result.httpStatus).toBe(500);
  });

  it('5. worker returns HTTP 200 with executed=0 → completed (valid empty run)', async () => {
    const result = await runScheduler({
      queuedCount: 0,
      fetchWorker: async () => ({ ok: true, status: 200, body: { executed: 0 } }),
    });

    expect(result.runUpdate.status).toBe('completed');
    expect(result.runUpdate.jobs_executed).toBe(0);
    expect(result.runUpdate.notes).toBeNull();
    expect(result.httpStatus).toBe(200);
  });
});
