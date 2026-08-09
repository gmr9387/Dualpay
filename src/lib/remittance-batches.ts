/**
 * Phase 10 — Remittance Batches persistence (Lovable Cloud).
 *
 * Thin audit log layered on top of import_batches: every committed
 * 835/EOB/remittance batch is summarized into `remittance_batches`
 * with counts of denials, underpayments, COB, plus dollar totals.
 *
 * Computes everything deterministically from already-validated rows
 * using the existing remittance normalizer + classifier — no new
 * scoring logic.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type {
  ImportBatch,
  ParsedRow,
  RemittanceBatchSummary,
} from '@/types/import';
import { normalizeRemittance } from '@/engine/remittance-normalizer';
import { classifyRemittance } from '@/engine/remittance-denial-extractor';
const sb = supabase as ReturnType<typeof createClient>;


export const REMITTANCE_BATCH_EVENT = 'clarity-remittance-batches';

function fromRow(r: Record<string, unknown>): RemittanceBatchSummary {
  return {
    batch_id: r.batch_id,
    file_name: r.file_name,
    payer_name: r.payer_name,
    record_count: r.record_count,
    denial_count: r.denial_count,
    underpayment_count: r.underpayment_count,
    cob_count: r.cob_count,
    total_billed_cents: Number(r.total_billed_cents ?? 0),
    total_paid_cents: Number(r.total_paid_cents ?? 0),
    total_adjustment_cents: Number(r.total_adjustment_cents ?? 0),
    expected_recovery_cents: Number(r.expected_recovery_cents ?? 0),
    imported_by: r.imported_by,
    uploaded_at: r.uploaded_at,
  };
}

export async function listRemittanceBatches(): Promise<RemittanceBatchSummary[]> {
  const { data, error } = await sb
    .from('remittance_batches')
    .select('*')
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

/**
 * Summarize a remittance batch's parsed rows and persist the result.
 * Called from commitBatch *after* claims are written.
 */
export async function persistRemittanceBatch(
  batch: ImportBatch,
  rows: ParsedRow[],
  expectedRecoveryCents: number,
): Promise<void> {
  let denial_count = 0;
  let underpayment_count = 0;
  let cob_count = 0;
  let total_billed_cents = 0;
  let total_paid_cents = 0;
  let total_adjustment_cents = 0;
  let payer_name: string | null = null;

  for (const r of rows) {
    if (r.status === 'error') continue;
    const rem = normalizeRemittance(r);
    const cls = classifyRemittance(rem);
    if (!payer_name && rem.payer_name) payer_name = rem.payer_name;
    total_billed_cents += rem.billed_cents;
    total_paid_cents += rem.paid_cents;
    total_adjustment_cents += rem.adjustment_cents;
    if (cls.kind === 'denial') denial_count++;
    else if (cls.kind === 'underpayment') underpayment_count++;
    else if (cls.kind === 'cob') cob_count++;
  }

  const payload = {
    batch_id: batch.batch_id,
    file_name: batch.file_name,
    payer_name,
    record_count: batch.record_count,
    denial_count,
    underpayment_count,
    cob_count,
    total_billed_cents,
    total_paid_cents,
    total_adjustment_cents,
    expected_recovery_cents: expectedRecoveryCents,
    imported_by: batch.uploaded_by,
  };

  const { error } = await sb
    .from('remittance_batches')
    .insert([payload]);
  if (error) {
    console.error('[remittance-batches] persist failed', error);
    return;
  }
  window.dispatchEvent(new Event(REMITTANCE_BATCH_EVENT));
}
