/**
 * Operational Workflows — Phase 3A Foundation / Phase 5A Appeal Atomicity
 *
 * Persistence layer for:
 * - Assignment workflow (assign, reassign, update priority/due date)
 * - Appeal lifecycle (Phase 5A: single authoritative path via rpc_advance_appeal_case)
 * - Recovery actions (log recovery transactions via ops_events)
 * - Claim notes (log notes via ops_events)
 * - Timeline queries (unified chronological history)
 *
 * Leverages:
 * - claim_assignments (extended with assigned_to_user_id, priority, due_date)
 * - ops_events (append-only audit trail with standardized kinds)
 * - recovery_outcomes (final recovery result)
 * - appeal_recovery_cases (appeal state machine)
 * - idempotency_keys (Phase 4B / 5A financial-mutation idempotency)
 *
 * Phase 5A change:
 *   advanceAppealCase() is now the sole authoritative appeal mutation.
 *   logAppealEvent() is preserved for call-site compatibility but internally
 *   routes through advanceAppealCase() with p_case_id = null so every appeal
 *   event is idempotency-protected and atomically written by the RPC.
 */

import { supabase } from '@/integrations/supabase/client';
const uuidv4 = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;

// ── Idempotency Key Factory ────────────────────────────────────
//
// Convention: every idempotency key MUST be prefixed with the operation name
// so the DB-level operation consistency check in rpc_* functions cannot be
// silently bypassed by a caller that reuses the same raw UUID across different
// operations.
//
// Supported prefixes:
//   payment:   → rpc_advance_payment_state
//   recovery:  → rpc_log_recovery_event
//   write_off: → rpc_log_write_off
//   appeal:    → rpc_advance_appeal_case
//
// Usage:
//   const key = makeIdempotencyKey('payment');
//
// The returned key is a stable, collision-resistant string that is safe to
// pass to any Phase 4B RPC.  Always generate a fresh key per logical request;
// never cache and re-send a key across retries that carry different payloads.

export type IdempotencyKeyOperation = 'payment' | 'recovery' | 'write_off' | 'appeal';

export function makeIdempotencyKey(operation: IdempotencyKeyOperation): string {
  return `${operation}:${uuidv4()}`;
}

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

// =========================================================
// Appeal Lifecycle — Phase 5A single authoritative path
// =========================================================

export interface AdvanceAppealCaseParams {
  /** Caller-supplied idempotency key (must be 'appeal:<uuid>'). */
  idempotencyKey: string;
  /** UUID of the appeal_recovery_cases row.  Pass null/undefined for
   *  the ops-events-only path (former logAppealEvent use case). */
  caseId?: string | null;
  orgId: string;
  /** Actor identifier (user UUID or display name). */
  actor?: string;
  /** Current state of the case (required when caseId is provided). */
  expectedState?: string;
  /** Target state (required when caseId is provided). */
  nextState?: string;
  /** Extra fields to patch on the case row inside the same transaction. */
  extraPatch?: {
    recovered_amount_cents?: number;
    payer_response_status?: string;
    packet_id?: string;
  };
  /** ops_events.kind — required for the audit row. */
  eventKind: 'appeal_submitted' | 'appeal_responded' | 'appeal_resolved';
  /** Human-readable summary for the audit row. */
  eventSummary: string;
  /** Additional structured payload for the audit row. */
  eventPayload?: {
    appeal_status?: string;
    payer_response?: string;
    notes?: string;
    [key: string]: unknown;
  };
  /** claim_id for ops_events linkage (required for timeline queries). */
  claimId?: string;
}

export interface AdvanceAppealCaseResult {
  alreadyConsumed: boolean;
  resultId: string;
  newState: string | null;
  eventId: string | null;
}

/**
 * Phase 5A: Single authoritative appeal mutation.
 *
 * Routes through rpc_advance_appeal_case (SECURITY DEFINER) which atomically:
 *   1. Reserves/checks the idempotency key
 *   2. Validates tenant membership
 *   3. Advances appeal_recovery_cases state (when caseId is provided)
 *   4. Applies extraPatch columns inside the same transaction
 *   5. Inserts exactly one ops_events audit row
 *   6. Commits result_id
 *
 * A duplicate request with the same idempotencyKey returns the original
 * resultId without creating a second state transition or audit event.
 */
export async function advanceAppealCase(
  params: AdvanceAppealCaseParams,
): Promise<AdvanceAppealCaseResult> {
  const {
    idempotencyKey,
    caseId,
    orgId,
    actor,
    expectedState,
    nextState,
    extraPatch,
    eventKind,
    eventSummary,
    eventPayload,
    claimId,
  } = params;

  if (!idempotencyKey) {
    throw new Error('advanceAppealCase: idempotencyKey is required');
  }

  const { data, error } = await supabase.rpc('rpc_advance_appeal_case', {
    p_idempotency_key: idempotencyKey,
    p_case_id:         caseId ?? null,
    p_org_id:          orgId,
    p_actor:           actor ?? 'unknown',
    p_expected_state:  expectedState ?? null,
    p_next_state:      nextState ?? null,
    p_extra_patch:     extraPatch ? (extraPatch as Record<string, unknown>) : null,
    p_event_kind:      eventKind,
    p_event_summary:   eventSummary,
    p_event_payload:   eventPayload ?? null,
    p_claim_id:        claimId ?? null,
  } as never);

  if (error) throw error;

  const result = data as {
    already_consumed: boolean;
    result_id: string;
    new_state: string | null;
    event_id: string | null;
  };

  return {
    alreadyConsumed: result.already_consumed,
    resultId: result.result_id,
    newState: result.new_state ?? null,
    eventId: result.event_id ?? null,
  };
}

/**
 * Log an appeal event.
 *
 * Phase 5A: Internally routes through advanceAppealCase() (which calls
 * rpc_advance_appeal_case) so every appeal event is idempotency-protected
 * and written atomically by the SECURITY DEFINER RPC.
 *
 * Call-site compatibility is preserved: callers do not need to change their
 * call shape, but they must now supply an idempotencyKey.
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
    /** Required (Phase 5A). Use makeIdempotencyKey('appeal'). */
    idempotencyKey: string;
    actor?: string;
  },
): Promise<string> {
  if (!params.idempotencyKey) {
    throw new Error('logAppealEvent: idempotencyKey is required');
  }

  const result = await advanceAppealCase({
    idempotencyKey: params.idempotencyKey,
    caseId:         null,   // ops-events-only path
    orgId,
    actor:          params.actor,
    eventKind:      params.kind,
    eventSummary:   params.summary,
    eventPayload: {
      appeal_status:  params.appealStatus,
      payer_response: params.payerResponse,
      notes:          params.notes,
    },
    claimId,
  });

  return result.resultId;
}

/**
 * Log a recovery transaction.
 *
 * Phase 4B: Routes through `rpc_log_recovery_event`, an atomic SECURITY
 * DEFINER RPC that inserts the ops_event, accumulates recovery_outcomes,
 * and records the idempotency key in a single transaction.
 *
 * @param idempotencyKey - Caller-supplied stable key for this logical request.
 *   Use a deterministic value derived from (claimId, recoveryType, amount,
 *   timestamp-of-intent) so that network retries re-use the same key.
 *   A duplicate request with the same key returns the original event_id
 *   without creating a second financial record.
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
    idempotencyKey: string;
  },
): Promise<string> {
  const { idempotencyKey, recoveryType, amountCents, recoveredFrom, analystUserId, notes } = params;

  if (!idempotencyKey) {
    throw new Error('logRecoveryEvent: idempotencyKey is required');
  }

  const { data, error } = await supabase.rpc('rpc_log_recovery_event', {
    p_idempotency_key: idempotencyKey,
    p_claim_id:        claimId,
    p_org_id:          orgId,
    p_actor:           analystUserId ?? 'unknown',
    p_recovery_type:   recoveryType,
    p_amount_cents:    amountCents,
    p_recovered_from:  recoveredFrom,
    p_notes:           notes ?? null,
  } as never);

  if (error) throw error;

  const result = data as { already_consumed: boolean; event_id: string };

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('clarity-outcomes'));
  }

  return result.event_id;
}

/**
 * Log a write-off.
 *
 * Phase 4B: Routes through `rpc_log_write_off`, an atomic SECURITY DEFINER
 * RPC that inserts the ops_event and records the idempotency key in a single
 * transaction.
 *
 * @param idempotencyKey - Caller-supplied stable key for this logical request.
 *   A duplicate request with the same key returns the original event_id
 *   without creating a second write-off event.
 */
export async function logWriteOff(
  claimId: string,
  orgId: string,
  reason: string,
  actor: string | undefined,
  idempotencyKey: string,
): Promise<string> {
  if (!idempotencyKey) {
    throw new Error('logWriteOff: idempotencyKey is required');
  }

  const { data, error } = await supabase.rpc('rpc_log_write_off', {
    p_idempotency_key: idempotencyKey,
    p_claim_id:        claimId,
    p_org_id:          orgId,
    p_actor:           actor ?? 'unknown',
    p_reason:          reason,
  } as never);

  if (error) throw error;

  const result = data as { already_consumed: boolean; event_id: string };
  return result.event_id;
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
