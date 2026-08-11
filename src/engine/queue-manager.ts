/**
 * Phase 17 — Queue Manager.
 *
 * Durable persistence layer for the background job queue.
 * All execution lives in worker-executor.ts; this file only mutates queue rows.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { appendOpsEvent } from '@/lib/ops-events';
import type { QueueJob, QueueJobStatus, QueueJobType, JobRun, JobFailure } from '@/types/platform';

const sb = supabase as ReturnType<typeof createClient>;

export const QUEUE_EVENT = 'clarity-queue';
const notify = () => window.dispatchEvent(new Event(QUEUE_EVENT));

// ---------- Enqueue ----------

export interface EnqueueInput {
  job_type: QueueJobType;
  pipeline_id?: string | null;
  priority?: number;
  payload?: Record<string, unknown>;
  max_attempts?: number;
}

export async function enqueueJob(input: EnqueueInput): Promise<QueueJob | null> {
  const row = {
    job_type: input.job_type,
    pipeline_id: input.pipeline_id ?? null,
    status: 'queued' as QueueJobStatus,
    priority: input.priority ?? 100,
    payload: (input.payload ?? null) as never,
    max_attempts: input.max_attempts ?? 3,
    next_attempt_at: new Date().toISOString(),
  };
  const { data, error } = await sb.from('job_queue').insert([row]).select('*').single();
  if (error || !data) { console.error('[queue] enqueue failed', error?.message); return null; }
  await appendOpsEvent({
    kind: 'job_queued',
    summary: `Queued ${input.job_type}`,
    payload: { queue_job_id: data.queue_job_id, pipeline_id: input.pipeline_id ?? null, priority: row.priority },
  });
  notify();
  return data as QueueJob;
}

export async function enqueueBatch(inputs: EnqueueInput[]): Promise<QueueJob[]> {
  const out: QueueJob[] = [];
  for (const i of inputs) {
    const j = await enqueueJob(i);
    if (j) out.push(j);
  }
  return out;
}

// ---------- Claim / lock ----------

export async function claimNextJob(worker_id: string): Promise<QueueJob | null> {
  // Find the highest-priority queued job that is ready.
  const { data, error } = await sb
    .from('job_queue').select('*')
    .eq('status', 'queued')
    .lte('next_attempt_at', new Date().toISOString())
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1).maybeSingle();
  if (error || !data) return null;

  // Lock via conditional update — re-check status to avoid double claim.
  const { data: locked, error: lockErr } = await sb.from('job_queue').update({
    status: 'running',
    worker_id,
    locked_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    attempts: (data.attempts ?? 0) + 1,
  }).eq('queue_job_id', data.queue_job_id).eq('status', 'queued').select('*').maybeSingle();
  if (lockErr || !locked) return null;
  await appendOpsEvent({
    kind: 'job_started',
    summary: `Worker ${worker_id} started ${locked.job_type}`,
    payload: { queue_job_id: locked.queue_job_id, worker_id, attempt: locked.attempts },
  });
  notify();
  return locked as QueueJob;
}

// ---------- Complete ----------

export async function completeQueueJob(
  job: QueueJob, worker_id: string, duration_ms: number,
  summary: { records_processed: number; records_succeeded: number; records_failed: number; details?: Record<string, unknown> },
): Promise<void> {
  await sb.from('job_queue').update({
    status: 'completed', completed_at: new Date().toISOString(), last_error: null,
  }).eq('queue_job_id', job.queue_job_id);

  await sb.from('job_runs').insert([{
    queue_job_id: job.queue_job_id,
    worker_id,
    duration_ms,
    status: 'completed',
    records_processed: summary.records_processed,
    records_succeeded: summary.records_succeeded,
    records_failed: summary.records_failed,
    result_summary: (summary.details ?? null) as never,
  }]);

  await appendOpsEvent({
    kind: 'job_completed',
    summary: `Completed ${job.job_type} in ${duration_ms}ms`,
    payload: { queue_job_id: job.queue_job_id, worker_id, ...summary },
  });
  notify();
}

// ---------- Fail / retry / dead-letter ----------

export async function failQueueJob(
  job: QueueJob, worker_id: string, duration_ms: number,
  err: { message: string; stack?: string | null },
): Promise<{ retried: boolean; dead: boolean }> {
  await sb.from('job_runs').insert([{
    queue_job_id: job.queue_job_id, worker_id, duration_ms,
    status: 'failed', records_processed: 0, records_succeeded: 0, records_failed: 0,
    result_summary: { error: err.message } as never,
  }]);

  await sb.from('job_failures').insert([{
    queue_job_id: job.queue_job_id,
    error_message: err.message,
    stack_trace: err.stack ?? null,
    retry_count: job.attempts,
  }]);

  const exhausted = job.attempts >= job.max_attempts;
  if (exhausted) {
    await sb.from('job_queue').update({
      status: 'dead_letter', completed_at: new Date().toISOString(), last_error: err.message,
    }).eq('queue_job_id', job.queue_job_id);
    await appendOpsEvent({
      kind: 'job_dead_lettered',
      summary: `Dead-lettered ${job.job_type} after ${job.attempts} attempts`,
      payload: { queue_job_id: job.queue_job_id, error: err.message },
    });
    notify();
    return { retried: false, dead: true };
  }

  // Schedule retry with exponential backoff (2^attempt seconds capped at 5m).
  const backoffMs = Math.min(2 ** job.attempts * 1000, 300_000);
  const next = new Date(Date.now() + backoffMs).toISOString();
  await sb.from('job_queue').update({
    status: 'queued', worker_id: null, locked_at: null, last_error: err.message, next_attempt_at: next,
  }).eq('queue_job_id', job.queue_job_id);
  await appendOpsEvent({
    kind: 'job_retried',
    summary: `Retry scheduled for ${job.job_type} in ${Math.round(backoffMs/1000)}s`,
    payload: { queue_job_id: job.queue_job_id, attempt: job.attempts, next_attempt_at: next },
  });
  notify();
  return { retried: true, dead: false };
}

// ---------- Read helpers ----------

export async function listQueueJobs(limit = 200): Promise<QueueJob[]> {
  const { data } = await sb.from('job_queue').select('*').order('created_at', { ascending: false }).limit(limit);
  return (data ?? []) as QueueJob[];
}

export async function listJobRuns(limit = 200): Promise<JobRun[]> {
  const { data } = await sb.from('job_runs').select('*').order('created_at', { ascending: false }).limit(limit);
  return (data ?? []) as JobRun[];
}

export async function listJobFailures(includeArchived = false, limit = 200): Promise<JobFailure[]> {
  let q = sb.from('job_failures').select('*').order('created_at', { ascending: false }).limit(limit);
  if (!includeArchived) q = q.eq('archived', false);
  const { data } = await q;
  return (data ?? []) as JobFailure[];
}

export async function getJob(queue_job_id: string): Promise<QueueJob | null> {
  const { data } = await sb.from('job_queue').select('*').eq('queue_job_id', queue_job_id).maybeSingle();
  return (data as QueueJob | null) ?? null;
}
