/**
 * Phase 20 — Remittance Lineage helpers.
 * Persist remittance lines, claim-source links, and append-only lineage events,
 * and provide a single read API used by the lineage viewer.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { appendOpsEvent } from '@/lib/ops-events';
const sb = supabase as ReturnType<typeof createClient>;


type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export type LineageSourceType =
  | 'import_batch'
  | 'remittance_batch'
  | 'remittance_line'
  | 'exception_correction'
  | 'manual_entry';

export type LineageEventType =
  | 'row_imported'
  | 'claim_created'
  | 'denial_detected'
  | 'underpayment_detected'
  | 'dispute_created'
  | 'case_created'
  | 'outcome_recorded'
  | 'executive_value_attributed';

export interface RemittanceLineRow {
  remittance_line_id: string;
  org_id: string;
  remittance_batch_id: string | null;
  import_batch_id: string | null;
  source_row_number: number | null;
  claim_id: string | null;
  payer_name: string | null;
  service_date: string | null;
  procedure_code: string | null;
  modifier: string | null;
  billed_amount_cents: number;
  allowed_amount_cents: number;
  paid_amount_cents: number;
  patient_responsibility_cents: number;
  adjustment_amount_cents: number;
  carc_code: string | null;
  rarc_code: string | null;
  group_code: string | null;
  classification: string | null;
  created_at: string;
}

export interface ClaimSourceLinkRow {
  link_id: string;
  org_id: string;
  claim_id: string;
  source_type: LineageSourceType;
  source_id: string | null;
  source_row_number: number | null;
  created_at: string;
}

export interface LineageEventRow {
  lineage_event_id: string;
  org_id: string;
  claim_id: string | null;
  remittance_line_id: string | null;
  dispute_id: string | null;
  outcome_id: string | null;
  event_type: LineageEventType;
  event_summary: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface InsertRemittanceLine {
  remittance_batch_id?: string | null;
  import_batch_id?: string | null;
  source_row_number?: number | null;
  claim_id?: string | null;
  payer_name?: string | null;
  service_date?: string | null;
  procedure_code?: string | null;
  modifier?: string | null;
  billed_amount_cents?: number;
  allowed_amount_cents?: number;
  paid_amount_cents?: number;
  patient_responsibility_cents?: number;
  adjustment_amount_cents?: number;
  carc_code?: string | null;
  rarc_code?: string | null;
  group_code?: string | null;
  classification?: string | null;
  payload?: Json | null;
}

export async function insertRemittanceLines(
  rows: InsertRemittanceLine[],
): Promise<RemittanceLineRow[]> {
  if (!rows.length) return [];
  const { data, error } = await sb
    .from('remittance_lines')
    .insert(rows)
    .select('*');
  if (error) { console.error('[lineage] insertRemittanceLines', error); return []; }
  return (data ?? []) as RemittanceLineRow[];
}

export async function insertClaimSourceLinks(
  links: Array<{
    claim_id: string;
    source_type: LineageSourceType;
    source_id?: string | null;
    source_row_number?: number | null;
    payload?: Json | null;
  }>,
): Promise<void> {
  if (!links.length) return;
  const { error } = await sb.from('claim_source_links').insert(links);
  if (error) console.error('[lineage] insertClaimSourceLinks', error);
}

export async function appendLineageEvents(
  events: Array<{
    claim_id?: string | null;
    remittance_line_id?: string | null;
    dispute_id?: string | null;
    outcome_id?: string | null;
    event_type: LineageEventType;
    event_summary: string;
    payload?: Json | null;
  }>,
): Promise<void> {
  if (!events.length) return;
  const { error } = await sb.from('recovery_lineage_events').insert(events);
  if (error) { console.error('[lineage] appendLineageEvents', error); return; }
  // Audit summary event (single roll-up — avoid spamming ops_events).
  await appendOpsEvent({
    kind: 'lineage_created',
    summary: `Recorded ${events.length} lineage event(s)`,
    payload: { count: events.length, types: events.map(e => e.event_type) },
  }).catch(() => {});
}

/** Single lineage event helper. */
export async function appendLineageEvent(ev: {
  claim_id?: string | null;
  remittance_line_id?: string | null;
  dispute_id?: string | null;
  outcome_id?: string | null;
  event_type: LineageEventType;
  event_summary: string;
  payload?: Json | null;
}): Promise<void> {
  await appendLineageEvents([ev]);
}

// ---------- Read API ----------

export async function listLineageForClaim(claimId: string): Promise<{
  links: ClaimSourceLinkRow[];
  lines: RemittanceLineRow[];
  events: LineageEventRow[];
}> {
  const [links, lines, events] = await Promise.all([
    sb.from('claim_source_links').select('*').eq('claim_id', claimId).order('created_at', { ascending: true }),
    sb.from('remittance_lines').select('*').eq('claim_id', claimId).order('created_at', { ascending: true }),
    sb.from('recovery_lineage_events').select('*').eq('claim_id', claimId).order('created_at', { ascending: true }),
  ]);
  return {
    links: (links.data ?? []) as ClaimSourceLinkRow[],
    lines: (lines.data ?? []) as RemittanceLineRow[],
    events: (events.data ?? []) as LineageEventRow[],
  };
}

export async function listRecentLineageEvents(limit = 200): Promise<LineageEventRow[]> {
  const { data, error } = await sb
    .from('recovery_lineage_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('[lineage] listRecentLineageEvents', error); return []; }
  return (data ?? []) as LineageEventRow[];
}

export async function getLineageSummary(): Promise<{
  total_lines: number; total_links: number; total_events: number;
}> {
  const [a, b, c] = await Promise.all([
    sb.from('remittance_lines').select('*', { count: 'exact', head: true }),
    sb.from('claim_source_links').select('*', { count: 'exact', head: true }),
    sb.from('recovery_lineage_events').select('*', { count: 'exact', head: true }),
  ]);
  return {
    total_lines: a.count ?? 0,
    total_links: b.count ?? 0,
    total_events: c.count ?? 0,
  };
}
