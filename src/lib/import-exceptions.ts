/**
 * Phase 9 — Import Exceptions persistence + correction/retry workflow.
 * Reuses validateRows (no duplicate validation engine) + rowToClaim.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { appendOpsEvent } from '@/lib/ops-events';
import { saveClaim } from '@/data/repository';
import { validateRows } from '@/engine/import-validation';
import { rowToClaim } from '@/engine/import-to-claim';
import type { ImportException, ExceptionStatus, ExceptionSeverity } from '@/types/exceptions';
import type {

  CanonicalField,
  FieldMapping,
  ImportBatch,
  ImportSourceType,
  ParsedRow,
  RowIssue,
} from '@/types/import';
const sb = supabase as ReturnType<typeof createClient>;

type Json = unknown;
const J = <T,>(v: T) => v as unknown as Json;

export const EXCEPTION_EVENT = 'clarity-import-exceptions';
const emit = () => window.dispatchEvent(new Event(EXCEPTION_EVENT));

function fromRow(r: Record<string, unknown>): ImportException {
  return {
    exception_id: r.exception_id,
    batch_id: r.batch_id,
    row_number: r.row_number,
    source_row: (r.source_row ?? {}) as Record<string, string>,
    mapped_row: (r.mapped_row ?? null) as ImportException['mapped_row'],
    severity: r.severity,
    status: r.status,
    error_count: r.error_count ?? 0,
    warning_count: r.warning_count ?? 0,
    validation_errors: (r.validation_errors ?? []) as RowIssue[],
    generated_claim_id: r.generated_claim_id ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    resolved_at: r.resolved_at,
  };
}

function makeExceptionId(batchId: string, rowNumber: number): string {
  return `EXC-${batchId.slice(0, 8)}-${String(rowNumber).padStart(5, '0')}`;
}

/** Persist all error/warning rows from a validation run as exceptions. */
export async function persistExceptions(batch: ImportBatch, rows: ParsedRow[]): Promise<number> {
  const failing = rows.filter(r => r.issues.length > 0);
  if (failing.length === 0) return 0;

  const payload = failing.map(r => {
    const errCount = r.issues.filter(i => i.level === 'error').length;
    const warnCount = r.issues.filter(i => i.level === 'warning').length;
    const severity: ExceptionSeverity = errCount > 0 ? 'error' : 'warning';
    return {
      exception_id: makeExceptionId(batch.batch_id, r.index + 1),
      batch_id: batch.batch_id,
      row_number: r.index + 1,
      source_row: J(r.raw),
      mapped_row: J(r.normalized),
      severity,
      status: 'open' as ExceptionStatus,
      error_count: errCount,
      warning_count: warnCount,
      validation_errors: J(r.issues),
    };
  });

  const { error } = await sb
    .from('import_exceptions')
    .upsert(payload, { onConflict: 'exception_id' });
  if (error) throw error;

  await appendOpsEvent({
    kind: 'exception_created',
    summary: `${failing.length} exception(s) preserved from batch ${batch.batch_id.slice(0, 8)}`,
    payload: { batch_id: batch.batch_id, file: batch.file_name, count: failing.length },
  });
  emit();
  return failing.length;
}

export async function listExceptions(filter?: {
  batch_id?: string;
  status?: ExceptionStatus;
  severity?: ExceptionSeverity;
}): Promise<ImportException[]> {
  let q = sb.from('import_exceptions').select('*').order('created_at', { ascending: false });
  if (filter?.batch_id) q = q.eq('batch_id', filter.batch_id);
  if (filter?.status) q = q.eq('status', filter.status);
  if (filter?.severity) q = q.eq('severity', filter.severity);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

export async function getException(id: string): Promise<ImportException | null> {
  const { data, error } = await sb
    .from('import_exceptions').select('*').eq('exception_id', id).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

/**
 * Update mapped values + re-run validation through the existing engine.
 * Returns the refreshed exception (status flips to "corrected" on clean re-validation).
 */
export async function correctException(
  exc: ImportException,
  edits: Partial<Record<CanonicalField, string | number>>,
  mapping: FieldMapping,
  source: ImportSourceType,
): Promise<{ exception: ImportException; issues: RowIssue[]; clean: boolean }> {
  const mergedMapped = { ...(exc.mapped_row ?? {}), ...edits };

  // Build a synthetic raw row keyed by header names from current mapping so we
  // can re-run validateRows() — the canonical validation engine.
  const syntheticRaw: Record<string, string> = { ...exc.source_row };
  for (const [field, header] of Object.entries(mapping)) {
    if (!header) continue;
    const v = mergedMapped[field as CanonicalField];
    if (v !== undefined && v !== null && v !== '') {
      syntheticRaw[header] = String(v);
    }
  }

  const { parsed } = validateRows([syntheticRaw], mapping, source);
  const row = parsed[0];
  const issues = row.issues;
  const errCount = issues.filter(i => i.level === 'error').length;
  const warnCount = issues.filter(i => i.level === 'warning').length;
  const clean = errCount === 0;

  const update = {
    mapped_row: J(mergedMapped),
    source_row: J(syntheticRaw),
    validation_errors: J(issues),
    error_count: errCount,
    warning_count: warnCount,
    severity: (errCount > 0 ? 'error' : 'warning') as ExceptionSeverity,
    status: (clean ? 'corrected' : 'open') as ExceptionStatus,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from('import_exceptions')
    .update(update)
    .eq('exception_id', exc.exception_id)
    .select('*')
    .single();
  if (error) throw error;

  await appendOpsEvent({
    kind: 'exception_corrected',
    summary: `Exception ${exc.exception_id} edited (${clean ? 'now clean' : `${errCount} error(s) remaining`})`,
    payload: { exception_id: exc.exception_id, batch_id: exc.batch_id, clean, edits },
  });
  emit();
  return { exception: fromRow(data), issues, clean };
}

export async function ignoreException(id: string): Promise<void> {
  const { error } = await sb
    .from('import_exceptions')
    .update({
      status: 'ignored',
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('exception_id', id);
  if (error) throw error;
  await appendOpsEvent({
    kind: 'exception_ignored',
    summary: `Exception ${id} marked ignored`,
    payload: { exception_id: id },
  });
  emit();
}

/**
 * Import (commit) a single corrected exception by routing it through the
 * existing claim conversion pipeline.
 */
export async function importException(
  exc: ImportException,
  source: ImportSourceType,
): Promise<{ claim_id: string } | null> {
  // Build a ParsedRow-shaped payload from current mapped values.
  const pseudo: ParsedRow = {
    index: exc.row_number - 1,
    raw: exc.source_row,
    normalized: exc.mapped_row ?? {},
    issues: exc.validation_errors,
    status: exc.error_count > 0 ? 'error' : exc.warning_count > 0 ? 'warning' : 'ok',
  };
  if (pseudo.status === 'error') return null;

  const { claim } = rowToClaim(pseudo, source, exc.batch_id);
  await saveClaim(claim);

  const { error } = await sb
    .from('import_exceptions')
    .update({
      status: 'imported',
      generated_claim_id: claim.claim_id,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('exception_id', exc.exception_id);
  if (error) throw error;

  await appendOpsEvent({
    kind: 'exception_imported',
    claim_id: claim.claim_id,
    summary: `Exception ${exc.exception_id} imported as ${claim.claim_id}`,
    payload: { exception_id: exc.exception_id, batch_id: exc.batch_id, claim_id: claim.claim_id },
  });
  emit();
  window.dispatchEvent(new Event('clarity-claims-changed'));
  return { claim_id: claim.claim_id };
}

/** Retry: import every currently clean (corrected) exception in a set. */
export async function retryExceptions(
  excs: ImportException[],
  source: ImportSourceType,
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  for (const e of excs) {
    if (e.status === 'imported' || e.status === 'ignored') { skipped++; continue; }
    if (e.error_count > 0) { skipped++; continue; }
    const r = await importException(e, source);
    if (r) imported++; else skipped++;
  }
  return { imported, skipped };
}
