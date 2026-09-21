/**
 * Case Management — status transitions and notes.
 *
 * Closes the loop on the `cases`/`case_events` domain model (types/case.ts):
 * autoCreateCase() creates cases for real via automation triggers, but until
 * now nothing ever moved a case forward or recorded a note against it. These
 * functions are the real progression/closure actions, following the same
 * withTriggerOrgId + createCaseEvent pattern already established in
 * engine/auto-case-generator.ts.
 */
import { supabase } from '@/integrations/supabase/client';
import { createCaseEvent } from '@/engine/case-management';
import { appendOpsEvent } from '@/lib/ops-events';
import { withTriggerOrgId } from '@/lib/supabase-helpers';
import type { Json } from '@/integrations/supabase/types';
import type { CaseEvent, CaseStatus } from '@/types/case';

const sb = supabase;

/** Valid forward/lateral transitions surfaced in the UI, keyed by current status. */
export const CASE_STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  OPEN: ['IN_REVIEW', 'CLOSED'],
  IN_REVIEW: ['PENDING_RETRO', 'RESOLVED', 'OPEN', 'CLOSED'],
  PENDING_RETRO: ['IN_REVIEW', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'IN_REVIEW'],
  CLOSED: ['IN_REVIEW'],
};

async function insertCaseEvent(evt: CaseEvent): Promise<boolean> {
  const { error } = await sb.from('case_events').insert(withTriggerOrgId([{
    event_id: evt.event_id,
    case_id: evt.case_id,
    occurred_at: evt.timestamp,
    event_type: evt.event_type,
    claim_id: evt.claim_id ?? null,
    description: evt.description,
    metadata: (evt.metadata ?? null) as Json,
  }]));
  if (error) { console.error('[case-actions] event insert failed', error.message); return false; }
  return true;
}

export async function updateCaseStatus(
  caseId: string,
  newStatus: CaseStatus,
  note?: string,
): Promise<CaseEvent | null> {
  const { error: updateErr } = await sb.from('cases').update({ status: newStatus }).eq('case_id', caseId);
  if (updateErr) { console.error('[case-actions] status update failed', updateErr.message); return null; }

  const description = note ? `Status changed to ${newStatus} — ${note}` : `Status changed to ${newStatus}`;
  const evt = createCaseEvent(caseId, 'STATUS_CHANGED', description, undefined, { new_status: newStatus });
  const ok = await insertCaseEvent(evt);
  if (!ok) return null;

  await appendOpsEvent({
    kind: 'case_status_changed',
    summary: `Case ${caseId} status → ${newStatus}`,
    payload: { case_id: caseId, new_status: newStatus },
  });

  return evt;
}

export async function addCaseNote(caseId: string, note: string, claimId?: string): Promise<CaseEvent | null> {
  const evt = createCaseEvent(caseId, 'NOTE_ADDED', note, claimId);
  const ok = await insertCaseEvent(evt);
  if (!ok) return null;

  await appendOpsEvent({
    kind: 'case_note_added',
    claim_id: claimId ?? null,
    summary: `Note added to case ${caseId}`,
    payload: { case_id: caseId },
  });

  return evt;
}
