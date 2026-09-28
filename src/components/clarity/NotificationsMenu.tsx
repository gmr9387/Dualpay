import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { relativeTime } from '@/hooks/use-clarity-data';
import { useOrg } from '@/hooks/use-org';

interface OpsEventRow {
  event_id: string;
  occurred_at: string;
  kind: string;
  summary: string | null;
  claim_id: string | null;
}

/** Real activity feed backed by ops_events -- the same append-only log Audit & Trace reads. */
export function NotificationsMenu() {
  const { currentOrg } = useOrg();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<OpsEventRow[]>([]);

  useEffect(() => {
    if (!open || !currentOrg) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from('ops_events')
      .select('event_id, occurred_at, kind, summary, claim_id')
      .eq('org_id', currentOrg.org_id)
      .order('occurred_at', { ascending: false })
      .limit(8)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error('[notifications] load failed', error.message);
        setEvents((data ?? []) as OpsEventRow[]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, currentOrg]);

  const [hasRecent, setHasRecent] = useState(false);
  useEffect(() => {
    if (!currentOrg) return;
    let cancelled = false;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    supabase
      .from('ops_events')
      .select('event_id', { count: 'exact', head: true })
      .eq('org_id', currentOrg.org_id)
      .gt('occurred_at', since)
      .then(({ count }) => { if (!cancelled) setHasRecent(!!count && count > 0); });
    return () => { cancelled = true; };
  }, [currentOrg]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground relative"
      >
        <Bell className="h-4 w-4" />
        {hasRecent && <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-status-denied" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 rounded-md border bg-card shadow-lg z-50">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b">
            Recent Activity {currentOrg ? `· ${currentOrg.name}` : ''}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {!currentOrg ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">Create or select an organization to see activity.</div>
            ) : loading ? (
              <div className="px-3 py-4 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            ) : events.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">No activity yet.</div>
            ) : (
              events.map(e => (
                <div key={e.event_id} className="px-3 py-2 border-b last:border-b-0 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-primary">{e.kind.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{relativeTime(e.occurred_at)}</span>
                  </div>
                  {e.summary && <div className="mt-0.5 text-foreground truncate">{e.summary}</div>}
                </div>
              ))
            )}
          </div>
          <Link to="/audit" onClick={() => setOpen(false)}
            className="block px-3 py-2 text-[11.5px] text-primary hover:bg-muted border-t">
            View all activity →
          </Link>
        </div>
      )}
    </div>
  );
}
