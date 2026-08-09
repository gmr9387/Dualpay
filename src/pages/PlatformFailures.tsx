import { useState } from 'react';
import { PageHeader, ScrollBody, Panel } from '@/components/clarity/primitives';
import { AlertTriangle, RefreshCcw, Archive, Eye } from 'lucide-react';
import { useJobFailures } from '@/hooks/use-platform';
import { archiveFailure, inspectFailure, reviveDeadLetter } from '@/engine/dead-letter-queue';
import { retryJob } from '@/engine/retry-engine';
import { useOrg } from '@/hooks/use-org';
import { roleAtLeast } from '@/lib/role-permissions';
import type { QueueJob, JobFailure } from '@/types/platform';

export default function PlatformFailures() {
  const { failures, reload } = useJobFailures(false);
  const { currentOrg } = useOrg();
  const canRetry = roleAtLeast(currentOrg?.role, 'manager');
  const canArchive = roleAtLeast(currentOrg?.role, 'admin');
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [inspected, setInspected] = useState<{ job: QueueJob | null; failures: JobFailure[] } | null>(null);

  const onInspect = async (id: string) => {
    setInspecting(id);
    const r = await inspectFailure(id);
    setInspected(r);
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Failure Center" subtitle="Inspect, retry, archive, or revive failed jobs." />
      <ScrollBody>
        <div className="p-6 space-y-4">
          <Panel title="Failures">
            {failures.length === 0 ? (
              <div className="p-6 text-[12px] text-muted-foreground">No active failures.</div>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="bg-muted/40 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">When</th>
                    <th className="text-left px-3 py-2">Job</th>
                    <th className="text-left px-3 py-2">Retry #</th>
                    <th className="text-left px-3 py-2">Error</th>
                    <th className="text-left px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.map(f => (
                    <tr key={f.failure_id} className="border-t">
                      <td className="px-3 py-2 text-muted-foreground">{new Date(f.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono text-[10.5px]">{f.queue_job_id.slice(0,8)}</td>
                      <td className="px-3 py-2">{f.retry_count}</td>
                      <td className="px-3 py-2 max-w-[400px] truncate" title={f.error_message}>{f.error_message}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <button onClick={() => onInspect(f.queue_job_id)} className="inline-flex items-center gap-1 text-[11px] underline">
                            <Eye className="h-3 w-3" /> Inspect
                          </button>
                          {canRetry && (
                            <button
                              onClick={async () => {
                                const job = (await inspectFailure(f.queue_job_id)).job;
                                if (job?.status === 'dead_letter') await reviveDeadLetter(f.queue_job_id);
                                else await retryJob(f.queue_job_id);
                                reload();
                              }}
                              className="inline-flex items-center gap-1 text-[11px] underline text-primary">
                              <RefreshCcw className="h-3 w-3" /> Retry
                            </button>
                          )}
                          {canArchive && (
                            <button
                              onClick={async () => { await archiveFailure(f.queue_job_id); reload(); }}
                              className="inline-flex items-center gap-1 text-[11px] underline text-muted-foreground">
                              <Archive className="h-3 w-3" /> Archive
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          {inspecting && inspected && (
            <Panel title={`Inspection · ${inspecting.slice(0,8)}`} >
              <pre className="p-4 text-[11px] font-mono whitespace-pre-wrap overflow-auto max-h-[400px]">
                {JSON.stringify(inspected, null, 2)}
              </pre>
            </Panel>
          )}
        </div>
      </ScrollBody>
    </div>
  );
}
