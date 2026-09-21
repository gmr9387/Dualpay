/**
 * Phase 21 — EDI Errors viewer
 *
 * Closes the loop: validation issues surfaced on import can now be marked
 * resolved (corrected upstream, re-submitted) or ignored (not a real
 * problem) with a note, instead of sitting in a read-only list forever.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, EyeOff } from 'lucide-react';
import { listEdiErrors, resolveEdiError } from '@/lib/edi-gateway';
import { useOrg } from '@/hooks/use-org';
import { can } from '@/lib/role-permissions';
import type { EdiErrorRow } from '@/types/edi';

export default function EdiErrors() {
  const { currentOrg } = useOrg();
  const canResolve = can.edit(currentOrg?.role);
  const [rows, setRows] = useState<EdiErrorRow[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => { listEdiErrors().then(setRows); }, []);

  const handleResolve = async (errorId: string, status: 'resolved' | 'ignored') => {
    setBusyId(errorId);
    const updated = await resolveEdiError(errorId, status, noteDrafts[errorId]?.trim() || undefined);
    if (updated) {
      setRows(prev => prev.map(r => (r.error_id === errorId ? updated : r)));
      setNoteDrafts(prev => ({ ...prev, [errorId]: '' }));
    }
    setBusyId(null);
  };

  const visibleRows = showResolved ? rows : rows.filter(r => r.status === 'open');

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><AlertTriangle className="h-6 w-6" /> EDI Errors</h1>
          <p className="text-sm text-muted-foreground">Validation issues surfaced by the X12 validator.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowResolved(!showResolved)}>
          {showResolved ? 'Hide resolved/ignored' : 'Show all'}
        </Button>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">{visibleRows.length} issues</CardTitle></CardHeader>
        <CardContent>
          {visibleRows.map((e) => (
            <div key={e.error_id} className="border-b border-border/40 py-2.5 text-xs space-y-1.5">
              <div className="flex items-center gap-2">
                <Badge variant={e.severity === 'error' ? 'destructive' : 'secondary'}>{e.severity}</Badge>
                <span className="font-mono">{e.error_code ?? 'UNCODED'}</span>
                <span className="text-muted-foreground">· {new Date(e.created_at).toLocaleString()}</span>
                {e.status !== 'open' && (
                  <Badge variant="outline" className="ml-auto">{e.status}</Badge>
                )}
              </div>
              <div className="text-foreground">{e.message}</div>
              <div className="text-muted-foreground font-mono">txn {e.transaction_id.slice(0, 8)}…</div>
              {e.status === 'open' && canResolve && (
                <div className="flex items-start gap-2 pt-1">
                  <input
                    value={noteDrafts[e.error_id] ?? ''}
                    onChange={ev => setNoteDrafts(prev => ({ ...prev, [e.error_id]: ev.target.value }))}
                    placeholder="Resolution note (optional)…"
                    className="flex-1 h-7 px-2 text-[11px] rounded border bg-background"
                  />
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]"
                    disabled={busyId === e.error_id}
                    onClick={() => handleResolve(e.error_id, 'resolved')}>
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Resolve
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]"
                    disabled={busyId === e.error_id}
                    onClick={() => handleResolve(e.error_id, 'ignored')}>
                    <EyeOff className="h-3 w-3 mr-1" /> Ignore
                  </Button>
                </div>
              )}
              {e.status !== 'open' && e.resolution_note && (
                <div className="text-muted-foreground italic">Note: {e.resolution_note}</div>
              )}
            </div>
          ))}
          {visibleRows.length === 0 && <p className="text-xs text-muted-foreground py-6">No errors recorded.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
