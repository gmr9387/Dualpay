import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader, Panel, ScrollBody } from '@/components/clarity/primitives';
import {
  getException, correctException, ignoreException, importException,
} from '@/lib/import-exceptions';
import { useImportBatches } from '@/hooks/use-import-batches';
import { CANONICAL_FIELDS } from '@/engine/import-schema';
import { STATUS_LABEL, type ImportException } from '@/types/exceptions';
import type { CanonicalField } from '@/types/import';
import { CheckCircle2, X, AlertTriangle, Trash2, Send, Save } from 'lucide-react';
import { toast } from 'sonner';

export default function ExceptionDetail() {
  const { exceptionId = '' } = useParams();
  const navigate = useNavigate();
  const { batches } = useImportBatches();
  const [exc, setExc] = useState<ImportException | null>(null);
  const [edits, setEdits] = useState<Partial<Record<CanonicalField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getException(exceptionId).then(e => { setExc(e); setEdits({}); }).finally(() => setLoading(false));
  }, [exceptionId]);

  const batch = useMemo(() => batches.find(b => b.batch_id === exc?.batch_id) ?? null, [batches, exc]);

  if (loading) return <Centered>Loading exception…</Centered>;
  if (!exc) return <Centered>Exception not found. <Link to="/factory/exceptions" className="text-primary hover:underline">Back to queue</Link>.</Centered>;

  const mapped = exc.mapped_row ?? {};

  async function save(commitAfter = false) {
    if (!batch) { toast.error('Batch metadata not loaded yet.'); return; }
    setSaving(true);
    try {
      const parsedEdits: Partial<Record<CanonicalField, string | number>> = {};
      for (const [k, v] of Object.entries(edits)) {
        if (v === undefined || v === '') continue;
        const def = CANONICAL_FIELDS.find(f => f.key === k);
        if (def?.kind === 'money') {
          const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
          if (isFinite(n)) parsedEdits[k as CanonicalField] = Math.round(n * 100);
        } else if (def?.kind === 'int') {
          const n = parseInt(String(v).replace(/[^0-9-]/g, ''), 10);
          if (isFinite(n)) parsedEdits[k as CanonicalField] = n;
        } else {
          parsedEdits[k as CanonicalField] = String(v);
        }
      }
      const result = await correctException(exc!, parsedEdits, batch.mapping, batch.source_type);
      setExc(result.exception); setEdits({});
      if (result.clean) {
        toast.success('Validation passed — exception ready to import.');
        if (commitAfter) {
          const imp = await importException(result.exception, batch.source_type);
          if (imp) {
            toast.success(`Imported as ${imp.claim_id}`);
            navigate('/factory/exceptions');
            return;
          }
        }
      } else {
        toast.warning(`${result.exception.error_count} error(s) remain after correction.`);
      }
    } catch (e) {
      toast.error('Save failed: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function commitNow() {
    if (!batch) return;
    if (exc!.error_count > 0) {
      toast.error('Fix all errors before importing.');
      return;
    }
    const r = await importException(exc!, batch.source_type);
    if (r) { toast.success(`Imported as ${r.claim_id}`); navigate('/factory/exceptions'); }
    else toast.error('Import failed.');
  }

  async function ignoreNow() {
    await ignoreException(exc!.exception_id);
    toast.success('Exception ignored.');
    navigate('/factory/exceptions');
  }

  const isResolved = exc.status === 'imported' || exc.status === 'ignored';

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`Exception ${exc.exception_id}`}
        subtitle={`${batch?.file_name ?? exc.batch_id} · row ${exc.row_number} · ${STATUS_LABEL[exc.status]}`}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={ignoreNow} disabled={isResolved}
              className="h-8 px-3 inline-flex items-center gap-1.5 text-[12px] rounded-md border bg-card hover:bg-muted disabled:opacity-50">
              <Trash2 className="h-3.5 w-3.5" /> Ignore
            </button>
            <button onClick={() => save(false)} disabled={saving || isResolved}
              className="h-8 px-3 inline-flex items-center gap-1.5 text-[12px] rounded-md border bg-card hover:bg-muted disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> Re-validate
            </button>
            <button onClick={() => save(true)} disabled={saving || isResolved}
              className="h-8 px-3 inline-flex items-center gap-1.5 text-[12px] rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <Send className="h-3.5 w-3.5" /> Save & Import
            </button>
            <button onClick={commitNow} disabled={isResolved || exc.error_count > 0}
              className="h-8 px-3 inline-flex items-center gap-1.5 text-[12px] rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              Import Corrected Record →
            </button>
          </div>
        }
      />
      <ScrollBody>
        <div className="grid grid-cols-3 gap-4 p-5">
          <div className="col-span-2 space-y-4">
            <Panel title="Validation Errors">
              {exc.validation_errors.length === 0 ? (
                <div className="py-4 text-center text-status-paid text-[12.5px] inline-flex items-center justify-center gap-2 w-full">
                  <CheckCircle2 className="h-4 w-4" /> All checks passed.
                </div>
              ) : (
                <ul className="space-y-1 text-[12.5px]">
                  {exc.validation_errors.map((i, k) => (
                    <li key={k} className="flex items-start gap-2">
                      {i.level === 'error'
                        ? <X className="h-3.5 w-3.5 text-status-denied mt-0.5 shrink-0" />
                        : <AlertTriangle className="h-3.5 w-3.5 text-status-pending mt-0.5 shrink-0" />}
                      <span>
                        <span className="font-mono text-[10.5px] text-muted-foreground mr-1.5">{i.field ?? 'row'}</span>
                        {i.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Mapped Values (editable)">
              <div className="grid grid-cols-2 gap-x-5 gap-y-2">
                {CANONICAL_FIELDS.map(f => {
                  const current = edits[f.key] ?? (mapped[f.key] !== undefined
                    ? (f.kind === 'money' && typeof mapped[f.key] === 'number'
                        ? ((mapped[f.key] as number) / 100).toFixed(2)
                        : String(mapped[f.key]))
                    : '');
                  const hasIssue = exc.validation_errors.some(i => i.field === f.key);
                  return (
                    <label key={f.key} className="flex flex-col gap-1 text-[12px]">
                      <span className="text-muted-foreground">
                        {f.label} <span className="font-mono text-[10.5px]">({f.kind})</span>
                      </span>
                      <input
                        value={current}
                        disabled={isResolved}
                        onChange={e => setEdits({ ...edits, [f.key]: e.target.value })}
                        className={`h-8 px-2 text-[12px] rounded-md border bg-card font-mono ${
                          hasIssue ? 'border-status-denied' : 'border-input'
                        } disabled:opacity-60`}
                      />
                    </label>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Original Row">
              <div className="space-y-1 text-[11.5px] font-mono max-h-[320px] overflow-y-auto">
                {Object.entries(exc.source_row).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">{k}:</span>
                    <span className="text-foreground break-all">{String(v)}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Audit">
              <ul className="text-[11.5px] space-y-1 text-muted-foreground">
                <li>Created · {new Date(exc.created_at).toLocaleString()}</li>
                <li>Updated · {new Date(exc.updated_at).toLocaleString()}</li>
                {exc.resolved_at && <li>Resolved · {new Date(exc.resolved_at).toLocaleString()}</li>}
                {exc.generated_claim_id && (
                  <li>Generated claim · <Link to={`/denials/${exc.generated_claim_id}`} className="text-primary hover:underline">{exc.generated_claim_id}</Link></li>
                )}
              </ul>
            </Panel>
            <div className="text-[11.5px]">
              <Link to="/factory/exceptions" className="text-primary hover:underline">← Back to queue</Link>
            </div>
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex items-center justify-center text-[13px] text-muted-foreground">{children}</div>;
}
