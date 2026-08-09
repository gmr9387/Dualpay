/**
 * Persistence layer (Lovable Cloud / Postgres).
 *
 * Hydrates the in-memory engine inputs from the database, persists
 * new adjudication runs / traces / case events, and seeds demo data
 * on first run if the DB is empty.
 *
 * Engine code (calculation-engine, cob-rules, case-management) is
 * intentionally pure and unaware of persistence. This module is the
 * only bridge between the engine and the database.
 */

import { supabase } from '@/integrations/supabase/client';
import type {
  Claim,
  AdjudicationRun,
  MemberAccumulators,
} from '@/types/claim';
import type { TraceObject } from '@/types/trace';
import type { Case, CaseEvent } from '@/types/case';
import type { ReplayRecord } from '@/engine/replay-store';
import type { ReplayLedgerEvent } from '@/engine/replay-ledger';
import {
  demoCases,
  demoCaseEvents,
} from './demo-scenarios';
import {
  clarityClaims,
  clarityAccumulators,
} from './clarity-scenarios';

// ── Loaders ───────────────────────────────────────────────────

export async function loadClaims(): Promise<Claim[]> {
  const { data, error } = await supabase
    .from('claims')
    .select('payload')
    .order('service_date_from', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => r.payload as unknown as Claim);
}

export async function loadCases(): Promise<Case[]> {
  const { data: cases, error: e1 } = await supabase
    .from('cases')
    .select('case_id, member_id, status, description, tags, created_at');
  if (e1) throw e1;

  const { data: links, error: e2 } = await supabase
    .from('case_claim_links')
    .select('case_id, claim_id');
  if (e2) throw e2;

  const linksByCase = new Map<string, string[]>();
  for (const l of links ?? []) {
    const arr = linksByCase.get(l.case_id) ?? [];
    arr.push(l.claim_id);
    linksByCase.set(l.case_id, arr);
  }

  return (cases ?? []).map((c) => ({
    case_id: c.case_id,
    member_id: c.member_id,
    status: c.status as Case['status'],
    description: c.description ?? '',
    tags: c.tags ?? [],
    created_at: c.created_at,
    claim_ids: linksByCase.get(c.case_id) ?? [],
  }));
}

export async function loadCaseEvents(): Promise<CaseEvent[]> {
  const { data, error } = await supabase
    .from('case_events')
    .select('event_id, case_id, claim_id, event_type, description, metadata, occurred_at')
    .order('occurred_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((e) => ({
    event_id: e.event_id,
    case_id: e.case_id,
    claim_id: e.claim_id ?? undefined,
    event_type: e.event_type as CaseEvent['event_type'],
    description: e.description,
    metadata: (e.metadata ?? undefined) as Record<string, unknown> | undefined,
    timestamp: e.occurred_at,
  }));
}

export async function loadAccumulators(): Promise<Record<string, MemberAccumulators>> {
  const { data, error } = await supabase
    .from('member_accumulators')
    .select('payload');
  if (error) throw error;
  const out: Record<string, MemberAccumulators> = {};
  for (const row of data ?? []) {
    const acc = row.payload as unknown as MemberAccumulators;
    if (acc?.member_id) out[acc.member_id] = acc;
  }
  return out;
}

export interface PersistedRun {
  claimId: string;
  run: AdjudicationRun;
  trace: TraceObject;
}

export async function loadLatestRuns(): Promise<PersistedRun[]> {
  const { data: runs, error } = await supabase
    .from('adjudication_runs')
    .select('run_id, claim_id, payload, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;

  // Pick the latest run per claim
  const latestByClaim = new Map<string, { run_id: string; claim_id: string; payload: unknown }>();
  for (const r of runs ?? []) {
    if (!latestByClaim.has(r.claim_id)) {
      latestByClaim.set(r.claim_id, r);
    }
  }

  const runIds = Array.from(latestByClaim.values()).map((r) => r.run_id);
  if (runIds.length === 0) return [];

  const { data: traces, error: tErr } = await supabase
    .from('traces')
    .select('run_id, payload')
    .in('run_id', runIds);
  if (tErr) throw tErr;

  const traceByRun = new Map<string, TraceObject>();
  for (const t of traces ?? []) {
    traceByRun.set(t.run_id, t.payload as unknown as TraceObject);
  }

  const out: PersistedRun[] = [];
  for (const r of latestByClaim.values()) {
    const trace = traceByRun.get(r.run_id);
    if (!trace) continue;
    out.push({
      claimId: r.claim_id,
      run: r.payload as unknown as AdjudicationRun,
      trace,
    });
  }
  return out;
}

// ── Writers ───────────────────────────────────────────────────

// Helper: cast our domain objects to the Json type expected by the
// generated Supabase types without losing structural info.
type Json =
  | string
  | number
  | boolean
  | null
  | { [k: string]: Json }
  | Json[];
const asJson = <T>(v: T): Json => v as unknown as Json;

export async function saveClaim(claim: Claim, orgId?: string): Promise<void> {
  // Revenue-readiness fix #3: guarantee org_id propagation so imported
  // claims are visible to every member of the org, not just the importer.
  let resolvedOrgId = orgId;
  if (!resolvedOrgId) {
    const { getCurrentOrgId } = await import('@/lib/current-org');
    resolvedOrgId = (await getCurrentOrgId()) ?? undefined;
  }
  const { error } = await supabase.from('claims').upsert([{
    claim_id: claim.claim_id,
    member_id: claim.member_id,
    provider_name: claim.provider_name ?? undefined,
    service_date_from: claim.service_date_from,
    service_date_to: claim.service_date_to ?? claim.service_date_from,
    status: claim.status,
    total_billed_cents: claim.total_billed,
    org_id: resolvedOrgId,
    payload: asJson(claim),
  }] as never);
  if (error) throw error;
}

export async function saveAdjudication(
  claimId: string,
  run: AdjudicationRun,
  trace: TraceObject,
  isRetro = false,
  orgId?: string,
): Promise<void> {
  const { error: runErr } = await supabase.from('adjudication_runs').upsert([{
    run_id: run.run_id,
    claim_id: claimId,
    total_plan_paid_cents: run.total_plan_paid,
    total_member_responsibility_cents: run.total_member_responsibility,
    is_retro: isRetro,
    org_id: orgId,
    payload: asJson(run),
  }] as never);
  if (runErr) throw runErr;

  const { error: traceErr } = await supabase.from('traces').upsert([{
    trace_id: trace.trace_id,
    run_id: run.run_id,
    claim_id: claimId,
    org_id: orgId,
    payload: asJson(trace),
  }] as never);
  if (traceErr) throw traceErr;
}

export async function saveAccumulators(acc: MemberAccumulators, orgId?: string): Promise<void> {
  const { error } = await supabase.from('member_accumulators').upsert([{
    member_id: acc.member_id,
    plan_year: acc.plan_year,
    individual_deductible_used_cents: acc.individual_deductible_used,
    individual_oop_used_cents: acc.individual_oop_used,
    family_deductible_used_cents: acc.family_deductible_used,
    family_oop_used_cents: acc.family_oop_used,
    org_id: orgId,
    payload: asJson(acc),
  }] as never);
  if (error) throw error;
}

export async function saveCase(c: Case, orgId?: string): Promise<void> {
  const { error: cErr } = await supabase.from('cases').upsert([{
    case_id: c.case_id,
    member_id: c.member_id,
    status: c.status,
    description: c.description,
    tags: c.tags,
    org_id: orgId,
  }] as never);
  if (cErr) throw cErr;

  // Replace links
  await supabase.from('case_claim_links').delete().eq('case_id', c.case_id);
  if (c.claim_ids.length > 0) {
    const { error: lErr } = await supabase.from('case_claim_links').insert(
      c.claim_ids.map((claim_id) => ({ case_id: c.case_id, claim_id, org_id: orgId })) as never,
    );
    if (lErr) throw lErr;
  }
}

export async function saveCaseEvent(evt: CaseEvent, orgId?: string): Promise<void> {
  const { error } = await supabase.from('case_events').upsert([{
    event_id: evt.event_id,
    case_id: evt.case_id,
    claim_id: evt.claim_id ?? undefined,
    event_type: evt.event_type,
    description: evt.description,
    metadata: evt.metadata ? asJson(evt.metadata) : undefined,
    org_id: orgId,
    occurred_at: evt.timestamp,
  }] as never);
  if (error) throw error;
}

// ── Replay Store Persistence ──────────────────────────────────

/**
 * Save a replay record to persistent storage.
 * Enforces uniqueness on snapshot_id, fingerprint, and run_id.
 */
export async function saveReplayRecordPersistent(record: ReplayRecord, orgId?: string): Promise<void> {
  const { error } = await supabase.from('replay_records').insert([{
    snapshot_id: record.snapshot.snapshot_id,
    run_id: record.run.run_id,
    fingerprint: record.fingerprint,
    claim_id: record.snapshot.claim_id,
    org_id: orgId,
    created_at: record.created_at,
    payload: asJson(record),
  }] as never);
  if (error) throw error;
}

/**
 * Load a replay record from persistent storage by snapshot_id.
 */
export async function getReplayRecordPersistent(
  snapshotId: string,
): Promise<ReplayRecord | null> {
  const { data, error } = await supabase
    .from('replay_records')
    .select('payload')
    .eq('snapshot_id', snapshotId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.payload as unknown as ReplayRecord) : null;
}

/**
 * Load a replay record by fingerprint.
 */
export async function getReplayRecordByFingerprintPersistent(
  fingerprint: string,
): Promise<ReplayRecord | null> {
  const { data, error } = await supabase
    .from('replay_records')
    .select('payload')
    .eq('fingerprint', fingerprint)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.payload as unknown as ReplayRecord) : null;
}

/**
 * Load a replay record by run_id.
 */
export async function getReplayRecordByRunIdPersistent(
  runId: string,
): Promise<ReplayRecord | null> {
  const { data, error } = await supabase
    .from('replay_records')
    .select('payload')
    .eq('run_id', runId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.payload as unknown as ReplayRecord) : null;
}

/**
 * List all replay records, ordered by creation time (newest first).
 */
export async function listReplayRecordsPersistent(): Promise<ReplayRecord[]> {
  const { data, error } = await supabase
    .from('replay_records')
    .select('payload')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => r.payload as unknown as ReplayRecord);
}

// ── Replay Ledger Persistence ────────────────────────────────

/**
 * Append a ledger event to persistent storage.
 */
export async function appendLedgerEventPersistent(
  event: ReplayLedgerEvent,
  orgId?: string,
): Promise<void> {
  const { error } = await supabase.from('replay_ledger_events').insert([{
    event_id: event.event_id,
    type: event.type,
    claim_id: event.claim_id,
    run_id: event.run_id ?? undefined,
    snapshot_id: event.snapshot_id ?? undefined,
    actor: event.actor,
    org_id: orgId,
    timestamp: event.timestamp,
    prev_event_hash: event.prev_event_hash,
    event_hash: event.event_hash,
    details: asJson(event.details),
  }] as never);
  if (error) throw error;
}

/**
 * List all ledger events in append order (oldest first).
 */
export async function listLedgerEventsPersistent(): Promise<ReplayLedgerEvent[]> {
  const { data, error } = await supabase
    .from('replay_ledger_events')
    .select('*')
    .order('timestamp', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    event_id: row.event_id,
    type: row.type as ReplayLedgerEvent['type'],
    claim_id: row.claim_id,
    run_id: row.run_id ?? undefined,
    snapshot_id: row.snapshot_id ?? undefined,
    actor: row.actor,
    timestamp: row.timestamp,
    prev_event_hash: row.prev_event_hash,
    event_hash: row.event_hash,
    details: (row.details ?? {}) as Record<string, unknown>,
  }));
}

/**
 * List ledger events for a specific claim.
 */
export async function listLedgerEventsForClaimPersistent(
  claimId: string,
): Promise<ReplayLedgerEvent[]> {
  const { data, error } = await supabase
    .from('replay_ledger_events')
    .select('*')
    .eq('claim_id', claimId)
    .order('timestamp', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    event_id: row.event_id,
    type: row.type as ReplayLedgerEvent['type'],
    claim_id: row.claim_id,
    run_id: row.run_id ?? undefined,
    snapshot_id: row.snapshot_id ?? undefined,
    actor: row.actor,
    timestamp: row.timestamp,
    prev_event_hash: row.prev_event_hash,
    event_hash: row.event_hash,
    details: (row.details ?? {}) as Record<string, unknown>,
  }));
}

// ── Idempotency Key Persistence ──────────────────────────────

/**
 * Record an idempotency key consumption in persistent storage.
 */
export async function recordIdempotencyKeyConsumption(
  key: string,
  claimId: string,
  actor: string,
): Promise<void> {
  const { error } = await supabase.from('idempotency_keys').insert([{
    key,
    claim_id: claimId,
    actor,
    consumed_at: new Date().toISOString(),
  }] as never);
  if (error) throw error;
}

/**
 * Check if an idempotency key has already been consumed.
 */
export async function isIdempotencyKeyConsumedPersistent(
  key: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('idempotency_keys')
    .select('key')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/**
 * List all consumed idempotency keys for a claim.
 */
export async function listIdempotencyKeysForClaimPersistent(
  claimId: string,
): Promise<{ key: string; actor: string; consumed_at: string }[]> {
  const { data, error } = await supabase
    .from('idempotency_keys')
    .select('key, actor, consumed_at')
    .eq('claim_id', claimId)
    .order('consumed_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ── Seed ──────────────────────────────────────────────────────

/**
 * Seed demo data on first run if DB is empty.
 * 
 * Creates Demo Organization and assigns explicit org_id to all seeded rows,
 * ensuring RLS policies can match authenticated users to the seeded data.
 * 
 * @returns { seeded: boolean, org_id?: string }
 */
export async function seedIfEmpty(): Promise<{ seeded: boolean; org_id?: string }> {
  // Phase 12 — demo seeds gated behind dev / VITE_DEMO_MODE.
  const { isDemoModeEnabled } = await import('@/lib/demo-flag');
  if (!isDemoModeEnabled()) return { seeded: false };

  // Detect whether the Claim Clarity dataset is present (sentinel: CLM-2024-00100).
  const { data: sentinel } = await supabase
    .from('claims')
    .select('org_id')
    .eq('claim_id', 'CLM-2024-00100')
    .maybeSingle();
  if (sentinel) return { seeded: false, org_id: sentinel.org_id };

  // 1. Get or create Demo Organization
  const { data: orgs, error: orgsError } = await supabase
    .from('organizations')
    .select('org_id')
    .eq('name', 'Demo Organization')
    .limit(1);

  if (orgsError) throw orgsError;

  let demoOrgId: string;
  if (orgs && orgs.length > 0) {
    demoOrgId = orgs[0].org_id;
  } else {
    const { data: newOrg, error: createError } = await supabase
      .from('organizations')
      .insert([{ name: 'Demo Organization' }])
      .select('org_id')
      .single();
    if (createError) throw createError;
    demoOrgId = newOrg.org_id;
  }

  // 2. Wipe legacy DualPay demo claims so the Clarity dataset is the source of truth.
  await supabase.from('case_events').delete().neq('event_id', '');
  await supabase.from('case_claim_links').delete().neq('case_id', '');
  await supabase.from('cases').delete().neq('case_id', '');
  await supabase.from('traces').delete().neq('trace_id', '');
  await supabase.from('adjudication_runs').delete().neq('run_id', '');
  await supabase.from('claims').delete().neq('claim_id', '');
  await supabase.from('member_accumulators').delete().neq('member_id', '');

  // 3. Re-seed with explicit org_id
  // Claims (Claim Clarity rich dataset — 28 claims with intel envelopes)
  for (const c of clarityClaims) {
    await saveClaim(c, demoOrgId);
  }

  // Accumulators
  for (const acc of Object.values(clarityAccumulators)) {
    await saveAccumulators(acc, demoOrgId);
  }

  // Cases (+ links) and events (legacy DualPay demo cases — kept for case management module)
  for (const cs of demoCases) {
    await saveCase(cs, demoOrgId);
  }
  for (const evt of demoCaseEvents) {
    await saveCaseEvent(evt, demoOrgId);
  }

  return { seeded: true, org_id: demoOrgId };
}
