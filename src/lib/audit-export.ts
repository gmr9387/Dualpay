/**
 * Phase 14 — Audit Export
 * Thin client wrapper around the `audit-export` edge function, which is the
 * only path to this data now. Role-gating, PHI redaction, the row cap, and
 * audit-logging all happen server-side (see supabase/functions/audit-export)
 * so a low-privilege user can't bypass any of it by calling the underlying
 * dualpay tables directly instead of going through this UI (RISK_REGISTER
 * #65 -- this file previously did all of that in client JS).
 */
import { supabase } from '@/integrations/supabase/client';

export type AuditDataset =
  | 'ops_events'
  | 'escalations'
  | 'assignments'
  | 'recovery_outcomes'
  | 'evidence_actions';

export type ExportFormat = 'csv' | 'json';
export type ExportMode = 'full' | 'redacted';

export interface ExportRequest {
  dataset: AuditDataset;
  format: ExportFormat;
  mode: ExportMode;
  orgId: string;
  from?: string;
  to?: string;
}

export interface ExportResult {
  dataset: AuditDataset;
  format: ExportFormat;
  mode: ExportMode;
  rowCount: number;
  filename: string;
  blobUrl: string;
  disclaimer: string;
}

export async function runAuditExport(req: ExportRequest): Promise<ExportResult> {
  const { data, error } = await supabase.functions.invoke('audit-export', {
    body: {
      org_id: req.orgId,
      dataset: req.dataset,
      format: req.format,
      mode: req.mode,
      from: req.from ?? null,
      to: req.to ?? null,
    },
  });
  if (error) throw error;
  const res = data as {
    ok?: boolean; error?: string; dataset: AuditDataset; format: ExportFormat; mode: ExportMode;
    rowCount: number; filename: string; content: string; disclaimer: string;
  };
  if (!res?.ok) throw new Error(res?.error ?? 'Export failed');

  const mime = res.format === 'json' ? 'application/json' : 'text/csv';
  const blob = new Blob([res.content], { type: `${mime};charset=utf-8` });
  const blobUrl = URL.createObjectURL(blob);

  return {
    dataset: res.dataset, format: res.format, mode: res.mode,
    rowCount: res.rowCount, filename: res.filename, blobUrl,
    disclaimer: res.disclaimer,
  };
}

export function downloadResult(r: ExportResult) {
  const a = document.createElement('a');
  a.href = r.blobUrl; a.download = r.filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(r.blobUrl), 1000);
}
