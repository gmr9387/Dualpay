/**
 * Phase 17 — Dead Letter Queue.
 *
 * Read & manage jobs that exhausted their retry budget.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { appendOpsEvent } from '@/lib/ops-events';
import { QUEUE_EVENT } from './queue-manager';
import { retryJob } from './retry-engine';
import type { QueueJob, JobFailure } from '@/types/platform';

const sb = supabase as ReturnType<typeof createClient>;
const notify = () => window.dispatchEvent(new Event(QUEUE_EVENT));

export async function listDeadLetterJobs(): Promise<QueueJob[]> {
  const { data } = await sb.from('job_queue').select('*')
    .eq('status', 'dead_letter').order('completed_at', { ascending: false }).limit(200);
  return (data ?? []) as QueueJob[];
}

export async function inspectFailure(queue_job_id: string): Promise<{ job: QueueJob | null; failures: JobFailure[] }> {
  const [{ data: job }, { data: failures }] = await Promise.all([
    sb.from('job_queue').select('*').eq('queue_job_id', queue_job_id).maybeSingle(),
    sb.from('job_failures').select('*').eq('queue_job_id', queue_job_id).order('created_at', { ascending: false }),
  ]);
  return { job: (job as QueueJob | null) ?? null, failures: (failures ?? []) as JobFailure[] };
}

export async function archiveFailure(queue_job_id: string): Promise<void> {
  await sb.from('job_failures').update({ archived: true }).eq('queue_job_id', queue_job_id);
  await appendOpsEvent({
    kind: 'job_dead_lettered',
    summary: `Archived dead-letter for job ${queue_job_id}`,
    payload: { queue_job_id, action: 'archived' },
  });
  notify();
}

export async function reviveDeadLetter(queue_job_id: string): Promise<QueueJob | null> {
  return retryJob(queue_job_id, { reset: true });
}
