import { useEffect, useState, useCallback } from 'react';
import { listWorkers, type WorkerRow } from '@/lib/worker-heartbeat';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

const sb = supabase as ReturnType<typeof createClient>;

export function useWorkers(refreshMs = 15000) {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const reload = useCallback(() => { listWorkers().then(setWorkers); }, []);
  useEffect(() => {
    reload();
    const t = setInterval(reload, refreshMs);
    return () => clearInterval(t);
  }, [reload, refreshMs]);
  return { workers, reload };
}

export interface SchedulerRunRow {
  run_id: string;
  scheduler_name: string;
  started_at: string;
  completed_at: string | null;
  jobs_discovered: number;
  jobs_executed: number;
  status: string;
}

export function useSchedulerRuns(refreshMs = 15000) {
  const [runs, setRuns] = useState<SchedulerRunRow[]>([]);
  const reload = useCallback(async () => {
    const { data } = await sb.from('scheduler_runs').select('*')
      .order('started_at', { ascending: false }).limit(50);
    setRuns((data ?? []) as SchedulerRunRow[]);
  }, []);
  useEffect(() => {
    reload();
    const t = setInterval(reload, refreshMs);
    return () => clearInterval(t);
  }, [reload, refreshMs]);
  return { runs, reload };
}
