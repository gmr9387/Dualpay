/**
 * Audit & Trace — reads real execution history from `ops_events`
 * and `traces` (Revenue-readiness fix #6).  No longer sourced from
 * static claim.intel.timeline JSON.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { relativeTime } from '@/hooks/use-clarity-data';
import { PageHeader, ScrollBody, Panel } from '@/components/clarity/primitives';
import { Loader2 } from 'lucide-react';

type Row = {
  event_id: string;
  occurred_at: string;
  kind: string;
  description: string;
  actor: string;
  claim_id: string | null;
  source: 'ops_events' | 'traces';
};

export default function AuditTrace() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [{ data: ops }, { data: traces }] = await Promise.all([
          supabase
            .from('ops_events')
            .select('event_id, occurred_at, kind, claim_id, actor, actor_name, actor_email, summary')
            .order('occurred_at', { ascending: false })
            .limit(500),
          supabase
            .from('traces')
            .select('trace_id, run_id, claim_id, payload, created_at')
            .order('created_at', { ascending: false })
            .limit(200),
        ]);

        const opsRows: Row[] = (ops ?? []).map((e: Record<string, unknown>) => ({
          event_id: e.event_id,
          occurred_at: e.occurred_at,
          kind: e.kind,
          description: e.summary ?? '',
          actor: e.actor_name ?? e.actor_email ?? e.actor ?? 'system',
          claim_id: e.claim_id,
          source: 'ops_events' as const,
        }));

        const traceRows: Row[] = (traces ?? []).map((t: Record<string, unknown>) => {
          const p = (t.payload ?? {}) as Record<string, unknown>;
          const rule_firings = (p.rule_firings as unknown[]) ?? [];
          return {
            event_id: t.trace_id,
            occurred_at: (p.timestamp as string) ?? t.created_at,
            kind: 'adjudication_trace',
            description: `Trace ${t.trace_id} · run ${t.run_id} · ${rule_firings.length} rule firing(s)`,
            actor: 'engine',
            claim_id: t.claim_id,
            source: 'traces' as const,
          };
        });

        const merged = [...opsRows, ...traceRows]
          .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
          .slice(0, 300);

        if (alive) { setRows(merged); setLoading(false); }
      } catch (err) {
        console.error('[audit-trace] load failed', err);
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="h-full flex items-center justify-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…</div>;

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Audit & Trace" subtitle="Immutable operational event log from ops_events and adjudication traces." />
      <ScrollBody>
        <div className="p-5">
          <Panel title={`Recent Events (${rows.length})`}>
            <div className="divide-y -mx-4 -my-4 text-[12px]">
              <div className="grid grid-cols-[140px_160px_1fr_180px_120px_90px] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                <span>When</span><span>Kind</span><span>Description</span><span>Actor</span><span>Claim</span><span>Source</span>
              </div>
              {rows.map(e => (
                <div key={`${e.source}-${e.event_id}`} className="grid grid-cols-[140px_160px_1fr_180px_120px_90px] gap-3 items-center px-4 py-2">
                  <span className="font-mono text-[11px] text-muted-foreground">{relativeTime(e.occurred_at)}</span>
                  <span className="font-mono text-[11px] font-semibold text-foreground truncate">{e.kind}</span>
                  <span className="text-foreground truncate">{e.description}</span>
                  <span className="text-muted-foreground truncate">{e.actor}</span>
                  {e.claim_id
                    ? <Link to={`/denials/${e.claim_id}`} className="font-mono text-[11px] text-primary hover:underline">{e.claim_id}</Link>
                    : <span className="font-mono text-[11px] text-muted-foreground">—</span>}
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{e.source === 'ops_events' ? 'ops' : 'trace'}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </ScrollBody>
    </div>
  );
}
