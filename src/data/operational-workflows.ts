/**
 * Operational Workflows — Phase 3A Foundation
 *
 * Persistence layer for:
 * - Assignment workflow (assign, reassign, update priority/due date)
 * - Appeal lifecycle (log appeal events via ops_events)
 * - Recovery actions (log recovery transactions via ops_events)
 * - Claim notes (log notes via ops_events)
 * - Timeline queries (unified chronological history)
 *
 * Leverages:
 * - claim_assignments (extended with assigned_to_user_id, priority, due_date)
 * - ops_events (append-only audit trail with standardized kinds)
 * - recovery_outcomes (final recovery result)
 *
 * No new tables. All workflow history tracked in ops_events.
 */

import { supabase } from '@/integrations/supabase/client';
const uuidv4 = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;

// =========================================================
// Types
// =========================================================

export interface ClaimAssignmentRecord {
  claim_id: string;
  /** Assigned user UUID, or `null` when explicitly unassigned. Never `undefined` in persisted state. */
  assigned_to_user_id: string | null;
  assigned_by_user_id?: string;
  assigned_at: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date?: string;
  status: 'open' | 'in_progress' | 'snoozed' | 'resolved';
  created_at: string;
  updated_at: string;
}

export interface TimelineEvent {
  event_id: string;
  occurred_at: string;
  kind: string;
  claim_id: string;
  actor: string | null;
  summary: string;
  payload: Record<string, unknown> | null;
}

export interface WorklistItem {
  claim_id: string;
  total_billed_cents: number;
  assigned_to_user_id?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date?: string;
  status: 'open' | 'in_progress' | 'snoozed' | 'resolved';
  assigned_at: string;
  days_until_due?: number;
  is_overdue: boolean;
}

// =========================================================
// Assignment Workflow
// =========================================================

/**
 * Create or update a claim assignment.
 */
export async function updateAssignment(
  claimId: string,
  orgId: string,
  params: {
    /** User UUID to assign to, or `null` to explicitly unassign. `undefined` = leave unchanged. */
    assignedToUserId?: string | null;
    assignedByUserId?: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    dueDate?: Date;
    status?: 'open' | 'in_progress' | 'snoozed' | 'resolved';
  },
): Promise<ClaimAssignmentRecord> {
  const {
    assignedToUserId,
    assignedByUserId,
    priority,
    dueDate,
    status,
  } = params;

  // Get current assignment (if exists)
  const { data: current } = await supabase
    .from('claim_assignments')
    .select('*')
    .eq('claim_id', claimId)
    .maybeSingle();

  // Prepare update payload
  const updateData: Record<string, unknown> = {
    org_id: orgId,
  };

  if (priority !== undefined) updateData.priority = priority;
  if (dueDate !== undefined) updateData.due_date = dueDate.toISOString();
  if (status !== undefined) updateData.status = status;
  if (assignedToUserId !== undefined) {
    // Normalize: null / '' / whitespace → explicit NULL persist (unassign).
    const normalized =
      assignedToUserId === null || (typeof assignedToUserId === 'string' && assignedToUserId.trim() === '')
        ? null
        : assignedToUserId;
    updateData.assigned_to_user_id = normalized;
  }
  if (assignedByUserId !== undefined) {
    updateData.assigned_by_user_id = assignedByUserId;
  }

  // Upsert assignment
  const { data, error } = await supabase
    .from('claim_assignments')
    .upsert([{
      claim_id: claimId,
      ...updateData,
    }] as never, { onConflict: 'claim_id' })
    .select()
    .single();

  if (error) throw error;

  // Log assignment event
  const isUnassign = assignedToUserId === null || (typeof assignedToUserId === 'string' && assignedToUserId.trim() === '');
  const eventKind = current
    ? (isUnassign ? 'assignment_unassigned' : 'assignment_updated')
    : 'assignment_created';
  const summary = current
    ? (isUnassign
        ? 'Claim unassigned'
        : `Assignment updated: ${priority ? `priority=${priority}` : ''} ${dueDate ? `due=${dueDate.toLocaleDateString()}` : ''}`)
    : `Assigned to ${assignedToUserId || 'unassigned'}`;

  await appendOpsEvent({
    kind: eventKind,
    claimId,
    orgId,
    summary,
    payload: {
      previous_assignee: current?.assigned_to_user_id ?? null,
      new_assignee: isUnassign ? null : (assignedToUserId ?? undefined),
      previous_priority: current?.priority,
      new_priority: priority,
      previous_due_date: current?.due_date,
      new_due_date: dueDate?.toISOString(),
      assigned_by: assignedByUserId,
    },
  });

  return data as ClaimAssignmentRecord;
}

/** Explicit unassign helper — persists `assigned_to_user_id = NULL` and logs `assignment_unassigned`. */
export async function unassignClaim(
  claimId: string,
  orgId: string,
  actorUserId?: string,
): Promise<ClaimAssignmentRecord> {
  return updateAssignment(claimId, orgId, {
    assignedToUserId: null,
    assignedByUserId: actorUserId,
  });
}

// =========================================================
// Notes & Events (ops_events)
// =========================================================

/**
 * Add a note to a claim.
 */
export async function addNote(
  claimId: string,
  orgId: string,
  note: string,
  actor?: string,
): Promise<string> {
  return appendOpsEvent({
    kind: 'note_added',
    claimId,
    orgId,
    summary: `Note added: ${note.substring(0, 100)}`,
    payload: { note },
    actor,
  });
}

/**
 * Log an appeal event.
 */
export async function logAppealEvent(
  claimId: string,
  orgId: string,
  params: {
    kind: 'appeal_submitted' | 'appeal_responded' | 'appeal_resolved';
    summary: string;
    appealStatus?: 'pending_response' | 'won' | 'lost' | 'withdrawn';
    payerResponse?: string;
    notes?: string;
  },
): Promise<string> {
  return appendOpsEvent({
    kind: params.kind,
    claimId,
    orgId,
    summary: params.summary,
    payload: {
      appeal_status: params.appealStatus,
      payer_response: params.payerResponse,
      notes: params.notes,
    },
  });
}

/**
 * Log a recovery transaction.
 */
export async function logRecoveryEvent(
  claimId: string,
  orgId: string,
  params: {
    recoveryType: 'payer_payment' | 'patient_payment' | 'writeoff' | 'adjustment';
    amountCents: number;
    recoveredFrom: string;
    analystUserId?: string;
    notes?: string;
  },
): Promise<string> {
  const summary = `Recovery recorded: ${params.recoveryType} of $${(params.amountCents / 100).toFixed(2)} from ${params.recoveredFrom}`;

  const eventId = await appendOpsEvent({
    kind: 'recovery_recorded',
    claimId,
    orgId,
    summary,
    payload: {
      recovery_type: params.recoveryType,
      amount_cents: params.amountCents,
      recovered_from: params.recoveredFrom,
      analyst_user_id: params.analystUserId,
      notes: params.notes,
    },
  });

  // Revenue-readiness fix #2: mirror operator recovery activity into
  // recovery_outcomes so Executive ROI dashboards reflect real work.
  try {
    await mirrorRecoveryToOutcome(claimId, orgId, params);
  } catch (e) {
    console.warn('[recovery] outcome mirror failed', e);
  }

  return eventId;
}

/**
 * Upsert a recovery_outcome row that summarises the recovery activity
 * performed against a claim.  Idempotent per (claim_id, recoveryType) —
 * repeated payments update the same outcome by summing amounts.
 */
async function mirrorRecoveryToOutcome(
  claimId: string,
  orgId: string,
  params: {
    recoveryType: 'payer_payment' | 'patient_payment' | 'writeoff' | 'adjustment';
    amountCents: number;
    recoveredFrom: string;
  },
): Promise<void> {
  const { data: claimRow } = await supabase
    .from('claims')
    .select('payload, total_billed_cents')
    .eq('claim_id', claimId)
    .maybeSingle();

  const payload = (claimRow?.payload as Record<string, unknown> | null) ?? null;
  const intel = (payload?.intel as Record<string, unknown> | undefined) ?? undefined;
  const payerId = (intel?.payer_id as string | undefined) ?? null;
  const payerName = (intel?.payer_name as string | undefined) ?? params.recoveredFrom;
  const category = (intel?.denial_events as Array<{ category?: string }> | undefined)?.[0]?.category ?? 'contractual';
  const workflow_owner = (intel?.workflow_owner as string | undefined) ?? 'unassigned';
  const denied = (intel?.amount_at_risk_cents as number | undefined) ?? (claimRow?.total_billed_cents as number | undefined) ?? params.amountCents;

  const resolution_type =
    params.recoveryType === 'writeoff' ? 'written_off'
    : params.recoveryType === 'patient_payment' ? 'patient_responsibility'
    : params.amountCents >= denied ? 'recovered_full'
    : 'recovered_partial';

  const outcome_id = `OUT-${claimId}-${params.recoveryType}`;
  const now = new Date().toISOString();

  // Read existing to accumulate (idempotent aggregation).
  const { data: existing } = await supabase
    .from('recovery_outcomes')
    .select('recovered_amount_cents, denied_amount_cents')
    .eq('outcome_id', outcome_id)
    .maybeSingle();

  const recovered_amount_cents = (existing?.recovered_amount_cents ?? 0) + params.amountCents;
  const denied_amount_cents = existing?.denied_amount_cents ?? denied;

  const { error } = await supabase.from('recovery_outcomes').upsert([{
    outcome_id,
    claim_id: claimId,
    org_id: orgId,
    payer_id: payerId,
    resolution_type,
    resolution_date: now,
    denied_amount_cents,
    recovered_amount_cents,
    unrecovered_amount_cents: Math.max(0, denied_amount_cents - recovered_amount_cents),
    notes: params.recoveredFrom,
    payload: {
      payer_name: payerName,
      category,
      workflow_owner,
      playbook_used: category,
      denial_date: now,
      days_to_resolution: 0,
      predicted_recoverability_score: 0,
      source: 'operator_recovery_event',
    },
    updated_at: now,
  }] as never, { onConflict: 'outcome_id' });

  if (error) console.warn('[recovery] outcome upsert failed', error.message);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('clarity-outcomes'));
  }
}

/**
 * Log a write-off.
 */
export async function logWriteOff(
  claimId: string,
  orgId: string,
  reason: string,
  actor?: string,
): Promise<string> {
  return appendOpsEvent({
    kind: 'claim_written_off',
    claimId,
    orgId,
    summary: `Claim written off: ${reason}`,
    payload: { reason },
    actor,
  });
}

/**
 * Internal: Append to ops_events audit trail.
 */
async function appendOpsEvent(params: {
  kind: string;
  claimId?: string;
  orgId: string;
  summary: string;
  payload?: Record<string, unknown>;
  actor?: string;
}): Promise<string> {
  const eventId = uuidv4();
  const now = new Date().toISOString();

  const { error } = await supabase.from('ops_events').insert([{
    event_id: eventId,
    kind: params.kind,
    claim_id: params.claimId ?? null,
    org_id: params.orgId,
    actor: params.actor ?? null,
    summary: params.summary,
    payload: params.payload ?? null,
    occurred_at: now,
    created_at: now,
  }] as never);

  if (error) throw error;
  return eventId;
}

// =========================================================
// My Worklist Queries
// =========================================================

/**
 * Get all claims assigned to the current user.
 * Includes open, in_progress, and snoozed statuses.
 */
export async function getMyWorklist(
  userId: string,
  orgId: string,
  includeResolved = false,
): Promise<WorklistItem[]> {
  let q = supabase
    .from('claim_assignments')
    .select(`
      claim_id,
      assigned_to_user_id,
      priority,
      due_date,
      status,
      assigned_at,
      claims(total_billed_cents)
    `)
    .eq('assigned_to_user_id', userId)
    .eq('org_id', orgId)
    .order('priority', { ascending: false })
    .order('due_date', { ascending: true });

  if (!includeResolved) {
    q = q.neq('status', 'resolved');
  }

  const { data, error } = await q;
  if (error) throw error;

  const now = new Date();
  return (data ?? []).map((row: Record<string, unknown>) => {
    const dueDate = row.due_date ? new Date(row.due_date) : null;
    const daysUntilDue = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : undefined;

    return {
      claim_id: row.claim_id,
      total_billed_cents: row.claims?.total_billed_cents ?? 0,
      assigned_to_user_id: row.assigned_to_user_id,
      priority: row.priority,
      due_date: row.due_date,
      status: row.status,
      assigned_at: row.assigned_at,
      days_until_due: daysUntilDue,
      is_overdue: dueDate ? dueDate < now : false,
    };
  });
}

/**
 * Get overdue assignments for the current user.
 */
export async function getOverdueClaims(
  userId: string,
  orgId: string,
): Promise<WorklistItem[]> {
  const { data, error } = await supabase
    .from('claim_assignments')
    .select(`
      claim_id,
      assigned_to_user_id,
      priority,
      due_date,
      status,
      assigned_at,
      claims(total_billed_cents)
    `)
    .eq('assigned_to_user_id', userId)
    .eq('org_id', orgId)
    .neq('status', 'resolved')
    .lt('due_date', new Date().toISOString())
    .order('due_date', { ascending: true });

  if (error) throw error;

  const now = new Date();
  return (data ?? []).map((row: Record<string, unknown>) => ({
    claim_id: row.claim_id,
    total_billed_cents: row.claims?.total_billed_cents ?? 0,
    assigned_to_user_id: row.assigned_to_user_id,
    priority: row.priority,
    due_date: row.due_date,
    status: row.status,
    assigned_at: row.assigned_at,
    days_until_due: row.due_date ? Math.ceil((new Date(row.due_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : undefined,
    is_overdue: true,
  }));
}

/**
 * Get claims due today for the current user.
 */
export async function getDueTodayClaims(
  userId: string,
  orgId: string,
): Promise<WorklistItem[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const { data, error } = await supabase
    .from('claim_assignments')
    .select(`
      claim_id,
      assigned_to_user_id,
      priority,
      due_date,
      status,
      assigned_at,
      claims(total_billed_cents)
    `)
    .eq('assigned_to_user_id', userId)
    .eq('org_id', orgId)
    .neq('status', 'resolved')
    .gte('due_date', today.toISOString())
    .lt('due_date', tomorrow.toISOString())
    .order('priority', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    claim_id: row.claim_id,
    total_billed_cents: row.claims?.total_billed_cents ?? 0,
    assigned_to_user_id: row.assigned_to_user_id,
    priority: row.priority,
    due_date: row.due_date,
    status: row.status,
    assigned_at: row.assigned_at,
    days_until_due: 0,
    is_overdue: false,
  }));
}

/**
 * Get high-dollar claims assigned to the current user (above threshold).
 */
export async function getHighDollarClaims(
  userId: string,
  orgId: string,
  minCentsBilled = 500000,
): Promise<WorklistItem[]> {
  const { data, error } = await supabase
    .from('claim_assignments')
    .select(`
      claim_id,
      assigned_to_user_id,
      priority,
      due_date,
      status,
      assigned_at,
      claims(total_billed_cents)
    `)
    .eq('assigned_to_user_id', userId)
    .eq('org_id', orgId)
    .neq('status', 'resolved')
    .gte('claims.total_billed_cents', minCentsBilled)
    .order('claims.total_billed_cents', { ascending: false });

  if (error) throw error;

  const now = new Date();
  return (data ?? []).map((row: Record<string, unknown>) => {
    const dueDate = row.due_date ? new Date(row.due_date) : null;
    return {
      claim_id: row.claim_id,
      total_billed_cents: row.claims?.total_billed_cents ?? 0,
      assigned_to_user_id: row.assigned_to_user_id,
      priority: row.priority,
      due_date: row.due_date,
      status: row.status,
      assigned_at: row.assigned_at,
      days_until_due: dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : undefined,
      is_overdue: dueDate ? dueDate < now : false,
    };
  });
}

// =========================================================
// Timeline (Unified Claim History)
// =========================================================

/**
 * Get complete chronological timeline for a claim.
 * Includes all ops_events (notes, appeals, recovery, assignments).
 * Ordered oldest → newest.
 */
export async function getClaimTimeline(
  claimId: string,
  orgId: string,
): Promise<TimelineEvent[]> {
  const { data, error } = await supabase
    .from('ops_events')
    .select('*')
    .eq('claim_id', claimId)
    .eq('org_id', orgId)
    .order('occurred_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    event_id: row.event_id,
    occurred_at: row.occurred_at,
    kind: row.kind,
    claim_id: row.claim_id,
    actor: row.actor,
    summary: row.summary,
    payload: row.payload ?? null,
  }));
}

/**
 * Get timeline filtered by specific event kinds.
 * Useful for appeal timeline, recovery timeline, note history, etc.
 */
export async function getClaimTimelineByKind(
  claimId: string,
  orgId: string,
  kinds: string[],
): Promise<TimelineEvent[]> {
  const { data, error } = await supabase
    .from('ops_events')
    .select('*')
    .eq('claim_id', claimId)
    .eq('org_id', orgId)
    .in('kind', kinds)
    .order('occurred_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    event_id: row.event_id,
    occurred_at: row.occurred_at,
    kind: row.kind,
    claim_id: row.claim_id,
    actor: row.actor,
    summary: row.summary,
    payload: row.payload ?? null,
  }));
}

/**
 * Get appeal timeline for a claim (all appeal_* events).
 */
export async function getAppealTimeline(
  claimId: string,
  orgId: string,
): Promise<TimelineEvent[]> {
  return getClaimTimelineByKind(
    claimId,
    orgId,
    ['appeal_submitted', 'appeal_responded', 'appeal_resolved'],
  );
}

/**
 * Get recovery timeline for a claim (all recovery_recorded events).
 */
export async function getRecoveryTimeline(
  claimId: string,
  orgId: string,
): Promise<TimelineEvent[]> {
  return getClaimTimelineByKind(claimId, orgId, ['recovery_recorded']);
}

/**
 * Get note timeline for a claim (all note_added events).
 */
export async function getNoteTimeline(
  claimId: string,
  orgId: string,
): Promise<TimelineEvent[]> {
  return getClaimTimelineByKind(claimId, orgId, ['note_added']);
}
