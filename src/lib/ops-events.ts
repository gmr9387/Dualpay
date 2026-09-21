import { supabase } from '@/integrations/supabase/client';

export type OpsEventKind =
  | 'assignment_changed'
  | 'escalation_raised'
  | 'escalation_resolved'
  | 'sla_acknowledged'
  | 'payer_followup_logged'
  | 'workflow_transition'
  | 'exception_created'
  | 'exception_corrected'
  | 'exception_imported'
  | 'exception_ignored'
  | 'document_uploaded'
  | 'document_updated'
  | 'document_linked'
  | 'document_removed'
  | 'appeal_packet_generated'
  | 'audit_export_requested'
  | 'audit_export_completed'
  | 'contract_uploaded'
  | 'contract_version_created'
  | 'contract_matched'
  | 'underpayment_detected'
  | 'dispute_created'
  | 'job_started'
  | 'job_completed'
  | 'job_failed'
  | 'rule_triggered'
  | 'case_auto_created'
  | 'dispute_auto_created'
  | 'pipeline_started'
  | 'pipeline_completed'
  | 'job_queued'
  | 'job_retried'
  | 'job_dead_lettered'
  | 'worker_registered'
  | 'worker_heartbeat'
  | 'scheduler_started'
  | 'scheduler_completed'
  | 'stalled_job_recovered'
  | 'contract_recovery_started'
  | 'contract_match_found'
  | 'contract_match_missing'
  | 'dispute_duplicate_skipped'
  | 'contract_recovery_completed'
  | 'lineage_created'
  | 'lineage_linked'
  | 'lineage_missing'
  | 'lineage_repaired'
  | 'edi_received'
  | 'edi_parsed'
  | 'edi_validated'
  | 'edi_rejected'
  | 'edi_normalized'
  | 'edi_imported'
  | 'edi_error_resolved'
  | 'fee_assessed'
  | 'plan_benefits_updated'
  | 'case_status_changed'
  | 'case_note_added'
  | 'recovery_report_generated'
  | 'recovery_report_sent'
  | 'client_response_recorded';

export interface OpsEvent {
  event_id: string;
  occurred_at: string;
  kind: OpsEventKind;
  claim_id?: string | null;
  actor?: string | null;
  actor_user_id?: string | null;
  actor_email?: string | null;
  actor_name?: string | null;
  summary: string;
  payload?: Record<string, unknown> | null;
  created_at?: string;
}

function makeEventId(): string {
  return `EV-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function getOpsEvents(): Promise<OpsEvent[]> {
  const { data, error } = await supabase
    .from('ops_events')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(1000);
  if (error) { console.error('[ops-events] load failed', error.message); return []; }
  return (data ?? []) as OpsEvent[];
}

export async function getOpsEventsForClaim(claimId: string): Promise<OpsEvent[]> {
  const { data, error } = await supabase
    .from('ops_events')
    .select('*')
    .eq('claim_id', claimId)
    .order('occurred_at', { ascending: false });
  if (error) { console.error('[ops-events] load claim events failed', error.message); return []; }
  return (data ?? []) as OpsEvent[];
}

export async function appendOpsEvent(
  ev: Omit<OpsEvent, 'event_id' | 'occurred_at' | 'created_at' | 'actor_user_id' | 'actor_email' | 'actor_name'> & { actor?: string | null },
): Promise<OpsEvent | null> {
  // Resolve real actor identity from Supabase session.
  const { data: { user } } = await supabase.auth.getUser();
  const actor_user_id = user?.id ?? null;
  const actor_email = user?.email ?? null;
  const actor_name =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    null;

  const row = {
    event_id: makeEventId(),
    occurred_at: new Date().toISOString(),
    kind: ev.kind,
    claim_id: ev.claim_id ?? null,
    actor: ev.actor ?? actor_name ?? actor_email ?? 'system',
    actor_user_id,
    actor_email,
    actor_name,
    summary: ev.summary,
    payload: (ev.payload ?? null) as never,
  };

  const { data, error } = await supabase
    .from('ops_events')
    .insert([row] as never)
    .select('*')
    .single();

  if (error) {
    console.error('[ops-events] append failed', error.message);
    return null;
  }

  window.dispatchEvent(new Event('clarity-ops-events'));
  return data as OpsEvent;
}

/** ops_events is append-only — kept for API compatibility. */
export async function clearOpsEvents(): Promise<void> {
  console.warn('[ops-events] clearOpsEvents is a no-op; table is append-only');
}
