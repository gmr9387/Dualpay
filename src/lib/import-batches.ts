/**
 * Recovery Factory — Import batch persistence (Lovable Cloud).
 */
import { supabase } from '@/integrations/supabase/client';
import type { ImportBatch, ImportSourceType, FieldMapping, ValidationSummary, ParsedRow } from '@/types/import';
import { rowToClaim } from '@/engine/import-to-claim';
import { saveClaim } from '@/data/repository';
import { persistExceptions } from '@/lib/import-exceptions';
import { persistRemittanceBatch } from '@/lib/remittance-batches';
import { reconcileRemittanceOutcomes } from '@/lib/recovery-reconciliation';
import { getCurrentOrgId } from '@/lib/current-org';
import { normalizeRemittance } from '@/engine/remittance-normalizer';
import { classifyRemittance } from '@/engine/remittance-denial-extractor';
import {
  insertRemittanceLines,
  insertClaimSourceLinks,
  appendLineageEvents,
  type InsertRemittanceLine,
} from '@/lib/lineage';

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];
const J = <T>(v: T) => v as unknown as Json;

const EVENT = 'clarity-import-batches';

function fromRow(r: any): ImportBatch {
  return {
    batch_id: r.batch_id,
    file_name: r.file_name,
    source_type: r.source_type,
    uploaded_by: r.uploaded_by,
    status: r.status,
    record_count: r.record_count,
    success_count: r.success_count,
    error_count: r.error_count,
    warning_count: r.warning_count,
    import_score: r.import_score,
    mapping: (r.mapping ?? {}) as FieldMapping,
    validation: (r.validation ?? {}) as ValidationSummary,
    generated_claim_ids: (r.generated_claim_ids ?? []) as string[],
    expected_recovery_cents: Number(r.expected_recovery_cents ?? 0),
    uploaded_at: r.uploaded_at,
    committed_at: r.committed_at,
  };
}

export async function listBatches(): Promise<ImportBatch[]> {
  const { data, error } = await (supabase as any)
    .from('import_batches')
    .select('*')
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

export async function createBatch(args: {
  file_name: string;
  source_type: ImportSourceType;
  mapping: FieldMapping;
  validation: ValidationSummary;
}): Promise<ImportBatch> {
  const payload = {
    file_name: args.file_name,
    source_type: args.source_type,
    status: 'validated',
    record_count: args.validation.total,
    success_count: args.validation.ok,
    error_count: args.validation.error,
    warning_count: args.validation.warning,
    import_score: args.validation.import_score,
    mapping: J(args.mapping),
    validation: J(args.validation),
  };
  const { data, error } = await (supabase as any)
    .from('import_batches')
    .insert([payload])
    .select('*')
    .single();
  if (error) throw error;
  window.dispatchEvent(new Event(EVENT));
  return fromRow(data);
}

export async function commitBatch(
  batch: ImportBatch,
  rows: ParsedRow[],
  source: ImportSourceType,
): Promise<{ committed: number; expected_recovery_cents: number; claim_ids: string[] }> {
  let expected = 0;
  const claim_ids: string[] = [];
  // Phase 20 lineage: collect (row → claim) pairs to persist after claims write.
  const rowClaimPairs: Array<{ row: ParsedRow; claim_id: string }> = [];
  for (const r of rows) {
    if (r.status === 'error') continue;
    try {
      const { claim, expectedRecoveryCents } = rowToClaim(r, source, batch.batch_id);
      await saveClaim(claim);
      claim_ids.push(claim.claim_id);
      rowClaimPairs.push({ row: r, claim_id: claim.claim_id });
      expected += expectedRecoveryCents;
    } catch {
      // skip row on conversion failure
    }
  }

  // Phase 9 — preserve every failed/warning row as an exception (no data loss).
  try {
    await persistExceptions(batch, rows);
  } catch (e) {
    console.error('[import-batches] persistExceptions failed', e);
  }

  // Phase 20 — durable lineage: remittance lines + claim source links + lineage events.
  try {
    const isRemittance = source === 'remittance_835';
    const lineInserts: InsertRemittanceLine[] = rowClaimPairs.map(({ row, claim_id }) => {
      if (isRemittance) {
        const rem = normalizeRemittance(row);
        const cls = classifyRemittance(rem);
        return {
          import_batch_id: batch.batch_id,
          source_row_number: row.index + 1,
          claim_id,
          payer_name: rem.payer_name,
          service_date: rem.service_date ?? null,
          procedure_code: rem.procedure_code ?? null,
          modifier: null,
          billed_amount_cents: rem.billed_cents,
          allowed_amount_cents: rem.allowed_cents,
          paid_amount_cents: rem.paid_cents,
          patient_responsibility_cents: rem.patient_resp_cents,
          adjustment_amount_cents: rem.adjustment_cents,
          carc_code: rem.carc_code ?? null,
          rarc_code: rem.rarc_code ?? null,
          group_code: rem.group_code ?? null,
          classification: cls.kind,
        };
      }
      // Non-remittance imports still get a lineage row so disputes can trace back.
      const n = row.normalized;
      const num = (k: string) => (typeof n[k] === 'number' ? (n[k] as number) : 0);
      const str = (k: string) => (n[k] == null || n[k] === '' ? null : String(n[k]));
      return {
        import_batch_id: batch.batch_id,
        source_row_number: row.index + 1,
        claim_id,
        payer_name: str('payer_name'),
        service_date: str('service_date'),
        procedure_code: str('procedure_code'),
        billed_amount_cents: num('billed_amount'),
        allowed_amount_cents: num('allowed_amount'),
        paid_amount_cents: num('paid_amount'),
        carc_code: str('carc_code'),
        rarc_code: str('rarc_code'),
        group_code: str('group_code'),
        classification: source,
      };
    });
    const insertedLines = await insertRemittanceLines(lineInserts);

    await insertClaimSourceLinks(rowClaimPairs.map(({ row, claim_id }, idx) => ({
      claim_id,
      source_type: isRemittance ? 'remittance_line' : 'import_batch',
      source_id: insertedLines[idx]?.remittance_line_id ?? batch.batch_id,
      source_row_number: row.index + 1,
      payload: { import_batch_id: batch.batch_id, source_type: source },
    })));

    const events = rowClaimPairs.flatMap(({ claim_id }, idx) => {
      const line = insertedLines[idx];
      return [
        {
          claim_id,
          remittance_line_id: line?.remittance_line_id ?? null,
          event_type: 'row_imported' as const,
          event_summary: `Row ${idx + 1} imported from ${batch.file_name}`,
          payload: { import_batch_id: batch.batch_id, source_type: source },
        },
        {
          claim_id,
          remittance_line_id: line?.remittance_line_id ?? null,
          event_type: 'claim_created' as const,
          event_summary: `Claim ${claim_id} created from ${source}`,
          payload: { import_batch_id: batch.batch_id },
        },
      ];
    });
    await appendLineageEvents(events);
  } catch (e) {
    console.error('[import-batches] lineage persist failed', e);
  }

  // Phase 10 — for 835 / remittance imports, summarize denials, underpayments, COB.
  if (source === 'remittance_835') {
    try {
      await persistRemittanceBatch(batch, rows, expected);
    } catch (e) {
      console.error('[import-batches] persistRemittanceBatch failed', e);
    }
    // Pilot fix #6 — auto-create recovery_outcomes so executive KPIs
    // reflect recovered dollars without requiring manual Outcome Log entries.
    try {
      const orgId = await getCurrentOrgId();
      if (orgId) {
        const { created } = await reconcileRemittanceOutcomes(batch, rowClaimPairs, orgId);
        if (created > 0) console.warn(`[reconcile] auto-created ${created} outcome(s)`);
      }
    } catch (e) {
      console.error('[import-batches] reconcileRemittanceOutcomes failed', e);
    }
  }

  const { error } = await (supabase as any)
    .from('import_batches')
    .update({
      status: 'committed',
      success_count: claim_ids.length,
      generated_claim_ids: J(claim_ids),
      expected_recovery_cents: expected,
      committed_at: new Date().toISOString(),
    })
    .eq('batch_id', batch.batch_id);
  if (error) throw error;
  window.dispatchEvent(new Event(EVENT));
  window.dispatchEvent(new Event('clarity-claims-changed'));
  return { committed: claim_ids.length, expected_recovery_cents: expected, claim_ids };
}

export const IMPORT_BATCH_EVENT = EVENT;
