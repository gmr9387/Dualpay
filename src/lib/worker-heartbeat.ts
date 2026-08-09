/**
 * Phase 18 — Worker heartbeat client helpers.
 *
 * Read-only access from the UI: list registered workers, age of last
 * heartbeat, lifetime throughput.  Writes happen server-side from the
 * worker-dispatcher edge function.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

const sb = supabase as ReturnType<typeof createClient>;

export interface WorkerRow {
  worker_id: string;
  status: string;
  version: string;
  last_heartbeat: string;
  jobs_processed: number;
  jobs_failed: number;
  registered_at: string;
  updated_at: string;
}

export async function listWorkers(): Promise<WorkerRow[]> {
  const { data, error } = await sb.from('worker_registry').select('*')
    .order('last_heartbeat', { ascending: false }).limit(100);
  if (error) { console.error('[worker-heartbeat] list failed', error.message); return []; }
  return (data ?? []) as WorkerRow[];
}

export function heartbeatAgeMs(row: WorkerRow): number {
  return Date.now() - new Date(row.last_heartbeat).getTime();
}

/** A worker is considered healthy if last heartbeat is within 5 minutes. */
export function isHealthy(row: WorkerRow): boolean {
  return heartbeatAgeMs(row) < 5 * 60 * 1000;
}
