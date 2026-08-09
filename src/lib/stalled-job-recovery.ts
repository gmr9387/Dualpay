/**
 * Phase 18 — Stalled job recovery client trigger.
 *
 * Server-side recovery runs every minute via the scheduler; this helper lets
 * the UI request an immediate recovery sweep for admins / managers via the
 * security-definer SQL function.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { appendOpsEvent } from '@/lib/ops-events';

const sb = supabase as ReturnType<typeof createClient>;

export async function recoverStalledJobs(staleMinutes = 10): Promise<number> {
  const { data, error } = await sb.rpc('recover_stalled_queue_jobs', { _stale_minutes: staleMinutes });
  if (error) {
    console.warn('[stalled-recovery] failed', error.message);
    return 0;
  }
  const count = (data as unknown as number) ?? 0;
  if (count > 0) {
    await appendOpsEvent({
      kind: 'stalled_job_recovered',
      summary: `Recovered ${count} stalled job(s)`,
      payload: { count, stale_minutes: staleMinutes },
    });
  }
  return count;
}
