/**
 * Phase 17 — Retry Engine.
 *
 * Manager-initiated re-queue of a previously failed job (whether it was
 * scheduled for retry or already dead-lettered).  Resets attempts when the
 * caller asks for a clean retry; otherwise preserves attempt history.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { appendOpsEvent } from '@/lib/ops-events';
import { QUEUE_EVENT } from './queue-manager';
import type { QueueJob } from '@/types/platform';

const sb = supabase as ReturnType<typeof createClient>;
const notify = () => window.dispatchEvent(new Event(QUEUE_EVENT));

export interface RetryOptions {
  /** Reset attempts to 0 (defaults to true). */
  reset?: boolean;
  /** Delay before next attempt (ms). */
  delay_ms?: number;
}

export async function retryJob(queue_job_id: string, opts: RetryOptions = {}): Promise<QueueJob | null> {
  const { data: existing } = await sb.from('job_queue').select('*').eq('queue_job_id', queue_job_id).maybeSingle();
  if (!existing) return null;
  const next_attempt_at = new Date(Date.now() + (opts.delay_ms ?? 0)).toISOString();
  const patch: Record<string, unknown> = {
    status: 'queued',
    worker_id: null,
    locked_at: null,
    completed_at: null,
    last_error: null,
    next_attempt_at,
  };
  if (opts.reset !== false) patch.attempts = 0;
  const { data, error } = await sb.from('job_queue').update(patch)
    .eq('queue_job_id', queue_job_id).select('*').single();
  if (error || !data) { console.error('[retry] failed', error?.message); return null; }
  await appendOpsEvent({
    kind: 'job_retried',
    summary: `Manual retry queued for ${existing.job_type}`,
    payload: { queue_job_id, reset: opts.reset !== false },
  });
  notify();
  return data as QueueJob;
}

/** Default retry policy used by the worker on transient failures. */
export const DEFAULT_RETRY_POLICY = {
  max_attempts: 3,
  backoff: (attempt: number) => Math.min(2 ** attempt * 1000, 300_000),
};
