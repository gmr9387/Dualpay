/**
 * Phase 17 — Worker Executor.
 *
 * Drains the job_queue and runs each job using the Phase 16 deterministic
 * handlers (no duplicate execution logic).  Browser-side worker — durable
 * because job state lives in Postgres; if the page reloads mid-run, the job
 * stays `running` until retried via the failures center or claimed again
 * once `locked_at` expires.
 */
import { claimNextJob, completeQueueJob, failQueueJob } from './queue-manager';
import { runJob } from './job-runner';
import type { QueueJob, QueueJobType } from '@/types/platform';
import type { JobRunResult } from '@/types/automation';

let _workerId: string | null = null;
function workerId(): string {
  if (_workerId) return _workerId;
  _workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;
  return _workerId;
}

export async function executeJob(job: QueueJob): Promise<{ ok: boolean; result?: JobRunResult; error?: Error }> {
  const start = Date.now();
  const wid = workerId();
  try {
    const handler = job.job_type as Exclude<QueueJobType, never>;
    // runJob persists into automation_jobs and reuses authoritative engines.
    const automationJob = await runJob(handler, {
      pipeline_id: job.pipeline_id ?? undefined,
      config: job.payload ?? undefined,
    });
    const duration = Date.now() - start;
    if (!automationJob || automationJob.status !== 'completed') {
      const msg = automationJob?.error_summary ?? `Handler ${handler} returned no result`;
      await failQueueJob(job, wid, duration, { message: msg });
      return { ok: false, error: new Error(msg) };
    }
    await completeQueueJob(job, wid, duration, {
      records_processed: automationJob.records_processed,
      records_succeeded: automationJob.records_succeeded,
      records_failed: automationJob.records_failed,
      details: automationJob.result ?? undefined,
    });
    return {
      ok: true,
      result: {
        records_processed: automationJob.records_processed,
        records_succeeded: automationJob.records_succeeded,
        records_failed: automationJob.records_failed,
        recovery_value_cents: automationJob.recovery_value_cents,
        details: automationJob.result ?? undefined,
      },
    };
  } catch (e) {
    const duration = Date.now() - start;
    const err = e instanceof Error ? e : new Error(String(e));
    await failQueueJob(job, wid, duration, { message: err.message, stack: err.stack ?? null });
    return { ok: false, error: err };
  }
}

/** Drain the queue: claim and execute jobs until none remain. */
export async function drainQueue(maxJobs = 25): Promise<{ executed: number; succeeded: number; failed: number }> {
  let executed = 0, succeeded = 0, failed = 0;
  const wid = workerId();
  while (executed < maxJobs) {
    const job = await claimNextJob(wid);
    if (!job) break;
    const res = await executeJob(job);
    executed += 1;
    if (res.ok) succeeded += 1; else failed += 1;
  }
  return { executed, succeeded, failed };
}

export function getWorkerId(): string { return workerId(); }
