/**
 * Phase 21 — EDI Gateway lib
 *
 * End-to-end ingestion: parse → validate → persist transaction + segments +
 * errors → normalize → optionally feed downstream (Remittance / Claims).
 *
 * Heavy downstream wiring (auto-creating remittance_batches/claims rows) is
 * deferred to existing engines; here we persist the EDI source-of-record and
 * emit ops events so that downstream pipelines can act on them.
 */
import { supabase } from '@/integrations/supabase/client';
import { parseX12, isLikelyX12 } from '@/engine/x12-parser';
import { validateX12 } from '@/engine/edi-validator';
import { normalize835, normalize837, type CanonicalClaim837 } from '@/engine/edi-normalizer';
import { appendOpsEvent } from '@/lib/ops-events';
import type { CanonicalRemittance } from '@/types/import';
import type { EdiErrorRow, EdiErrorStatus, EdiTransactionRow } from '@/types/edi';

export { isLikelyX12 };

export interface EdiIngestResult {
  transaction_id: string | null;
  transaction_type: string;
  valid: boolean;
  segment_count: number;
  error_count: number;
  remittances?: CanonicalRemittance[];
  claims?: CanonicalClaim837[];
}

export async function ingestEdiFile(file: { name: string; content: string }): Promise<EdiIngestResult> {
  if (!isLikelyX12(file.content)) {
    return { transaction_id: null, transaction_type: 'unknown', valid: false, segment_count: 0, error_count: 1 };
  }

  const parsed = parseX12(file.content, { filename: file.name });
  const validation = validateX12(parsed);

  // 1) Insert transaction
  const { data: txn, error: txErr } = await supabase
    .from('edi_transactions')
    .insert([{
      transaction_type: parsed.envelope.transaction_type,
      file_name: file.name,
      sender_id: parsed.envelope.sender_id ?? null,
      receiver_id: parsed.envelope.receiver_id ?? null,
      interchange_control_number: parsed.envelope.interchange_control_number ?? null,
      functional_group_number: parsed.envelope.functional_group_number ?? null,
      transaction_set_number: parsed.envelope.transaction_set_number ?? null,
      status: validation.valid ? 'validated' : 'rejected',
      validation_status: validation.valid ? 'valid' : 'invalid',
      segment_count: parsed.segments.length,
      error_count: validation.issues.length,
      raw_content: file.content,
      metadata: { delimiters: {
        element: parsed.element_separator,
        segment: parsed.segment_terminator,
        sub_element: parsed.sub_element_separator,
      } } as never,
    }] as never)
    .select('transaction_id')
    .single();

  if (txErr || !txn) {
    console.error('[edi] transaction insert failed', txErr?.message);
    return { transaction_id: null, transaction_type: parsed.envelope.transaction_type, valid: false, segment_count: parsed.segments.length, error_count: validation.issues.length };
  }
  const transaction_id = (txn as { transaction_id: string }).transaction_id;
  await appendOpsEvent({ kind: 'edi_received', summary: `Received ${parsed.envelope.transaction_type} (${file.name})`, payload: { transaction_id, segments: parsed.segments.length } });

  // 2) Insert segments
  const segRows = parsed.segments.map((s) => ({
    transaction_id,
    segment_type: s.segment_type,
    sequence_number: s.sequence_number,
    raw_segment: s.raw_segment,
    parsed_json: s.parsed_json as never,
  }));
  if (segRows.length) {
    const { error: segErr } = await supabase.from('edi_segments').insert(segRows as never);
    if (segErr) console.error('[edi] segments insert failed', segErr.message);
  }

  // 3) Insert errors
  if (validation.issues.length) {
    const errRows = validation.issues.map((i) => ({
      transaction_id,
      severity: i.severity,
      error_code: i.error_code ?? null,
      message: i.message,
    }));
    const { error: eErr } = await supabase.from('edi_errors').insert(errRows as never);
    if (eErr) console.error('[edi] errors insert failed', eErr.message);
    await appendOpsEvent({ kind: validation.valid ? 'edi_validated' : 'edi_rejected', summary: `${validation.valid ? 'Validated' : 'Rejected'} ${file.name} (${validation.issues.length} issues)`, payload: { transaction_id } });
  } else {
    await appendOpsEvent({ kind: 'edi_validated', summary: `Validated ${file.name}`, payload: { transaction_id } });
  }

  if (!validation.valid) {
    return {
      transaction_id, transaction_type: parsed.envelope.transaction_type,
      valid: false, segment_count: parsed.segments.length, error_count: validation.issues.length,
    };
  }

  // 4) Normalize
  let remittances: CanonicalRemittance[] | undefined;
  let claims: CanonicalClaim837[] | undefined;
  if (parsed.envelope.transaction_type === '835') {
    remittances = normalize835(parsed);
  } else if (parsed.envelope.transaction_type === '837P' || parsed.envelope.transaction_type === '837I') {
    claims = normalize837(parsed);
  }

  await supabase
    .from('edi_transactions')
    .update({ status: 'normalized' } as never)
    .eq('transaction_id', transaction_id);

  await appendOpsEvent({
    kind: 'edi_normalized',
    summary: `Normalized ${parsed.envelope.transaction_type}: ${remittances?.length ?? claims?.length ?? 0} records`,
    payload: { transaction_id, remittance_count: remittances?.length ?? 0, claim_count: claims?.length ?? 0 },
  });

  return {
    transaction_id,
    transaction_type: parsed.envelope.transaction_type,
    valid: true,
    segment_count: parsed.segments.length,
    error_count: validation.issues.length,
    remittances,
    claims,
  };
}

export async function listEdiTransactions(): Promise<EdiTransactionRow[]> {
  const { data, error } = await supabase
    .from('edi_transactions')
    .select('transaction_id, org_id, transaction_type, file_name, sender_id, receiver_id, interchange_control_number, functional_group_number, transaction_set_number, status, validation_status, segment_count, error_count, received_at')
    .order('received_at', { ascending: false })
    .limit(500);
  if (error) { console.error('[edi] list failed', error.message); return []; }
  return (data ?? []) as EdiTransactionRow[];
}

export async function listEdiErrors(): Promise<EdiErrorRow[]> {
  const { data, error } = await supabase
    .from('edi_errors')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) { console.error('[edi] errors failed', error.message); return []; }
  return (data ?? []) as EdiErrorRow[];
}

export async function resolveEdiError(
  errorId: string,
  status: Extract<EdiErrorStatus, 'resolved' | 'ignored'>,
  note?: string,
): Promise<EdiErrorRow | null> {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('edi_errors')
    .update({
      status,
      resolution_note: note ?? null,
      resolved_at: new Date().toISOString(),
      resolved_by: user?.id ?? null,
    } as never)
    .eq('error_id', errorId)
    .select('*')
    .single();

  if (error) { console.error('[edi] error resolution failed', error.message); return null; }

  await appendOpsEvent({
    kind: 'edi_error_resolved',
    summary: `EDI error ${status}: ${errorId.slice(0, 8)}…`,
    payload: { error_id: errorId, status },
  });

  return data as EdiErrorRow;
}
