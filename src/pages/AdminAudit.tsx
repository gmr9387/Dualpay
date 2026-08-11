import { useState } from 'react';
import { RequireRole } from '@/components/auth/RequireRole';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useOrg } from '@/hooks/use-org';
import { runAuditExport, downloadResult, type AuditDataset, type ExportFormat, type ExportMode, type ExportResult } from '@/lib/audit-export';
import { toast } from 'sonner';

export default function AdminAudit() {
  return (
    <RequireRole min="manager">
      <AdminAuditInner />
    </RequireRole>
  );
}

function AdminAuditInner() {
  const { currentOrg } = useOrg();
  const [dataset, setDataset] = useState<AuditDataset>('ops_events');
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [mode, setMode] = useState<ExportMode>('redacted');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<ExportResult | null>(null);

  const isAdmin = currentOrg?.role === 'admin' || currentOrg?.role === 'owner';

  const onRun = async () => {
    if (!currentOrg) return;
    if (mode === 'full' && !isAdmin) {
      toast.error('Full PHI exports require admin or owner role.');
      return;
    }
    setRunning(true);
    try {
      const r = await runAuditExport({
        dataset, format, mode, orgId: currentOrg.org_id,
        from: from || undefined, to: to || undefined,
      });
      setLast(r);
      downloadResult(r);
      toast.success(`Exported ${r.rowCount} rows`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Export failed';
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Audit Export</h1>
        <p className="text-sm text-muted-foreground">
          Export org-scoped operational and audit records. Every export is logged to the audit chain.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Configure export</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Dataset">
              <Select value={dataset} onValueChange={v => setDataset(v as AuditDataset)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ops_events">Ops Events</SelectItem>
                  <SelectItem value="escalations">Escalations</SelectItem>
                  <SelectItem value="assignments">Assignments</SelectItem>
                  <SelectItem value="recovery_outcomes">Recovery Outcomes</SelectItem>
                  <SelectItem value="evidence_actions">Evidence Actions</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Format">
              <Select value={format} onValueChange={v => setFormat(v as ExportFormat)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Mode">
              <Select value={mode} onValueChange={v => setMode(v as ExportMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="redacted">Redacted (PHI removed)</SelectItem>
                  <SelectItem value="full" disabled={!isAdmin}>Full {isAdmin ? '' : '(admin only)'}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
              <Field label="To"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
            </div>
          </div>

          <Alert>
            <AlertDescription className="text-xs">
              {mode === 'redacted'
                ? 'Redacted export removes member identifiers, personal identifiers, and sensitive filenames. Suitable for vendor or regulator sharing.'
                : 'Full export may contain Protected Health Information. Treat per your BAA and HIPAA policies.'}
            </AlertDescription>
          </Alert>

          <Button onClick={onRun} disabled={running || !currentOrg}>
            {running ? 'Running…' : 'Run export & download'}
          </Button>
        </CardContent>
      </Card>

      {last && (
        <Card>
          <CardHeader><CardTitle className="text-base">Last export</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div><span className="text-muted-foreground">Dataset:</span> {last.dataset}</div>
            <div><span className="text-muted-foreground">Mode:</span> {last.mode}</div>
            <div><span className="text-muted-foreground">Rows:</span> {last.rowCount}</div>
            <div><span className="text-muted-foreground">File:</span> {last.filename}</div>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => downloadResult(last)}>Re-download</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
