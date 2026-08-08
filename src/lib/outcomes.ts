/**
 * Recovery Outcome store — persisted in Supabase `recovery_outcomes`.
 *
 * The RecoveryOutcome shape used by analytics carries a number of
 * derived fields (payer_name, category, workflow_owner, playbook_used,
 * days_to_resolution, predicted_recoverability_score, denial_date) that
 * do not have dedicated columns in the persisted schema.  Those fields
 * are stored inside the `payload` JSON column and rehydrated on read so
 * the existing analytics engines continue to work unchanged.
 */
import type { Claim } from '@/types/claim';
import type { ClaimIntel, DenialCategory } from '@/types/clarity';
import type { RecoveryOutcome, ResolutionType } from '@/types/outcomes';
import { explainRecoverability } from '@/engine/recoverability';
import { supabase } from '@/integrations/supabase/client';
import { appendLineageEvent } from '@/lib/lineage';

type Row = {
  outcome_id: string;
  claim_id: string;
  denial_id: string | null;
  payer_id: string | null;
  resolution_type: string;
  resolution_date: string;
  denied_amount_cents: number;
  recovered_amount_cents: number;
  unrecovered_amount_cents: number;
  notes: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function rowToOutcome(r: Row): RecoveryOutcome {
  const p = (r.payload ?? {}) as Partial<RecoveryOutcome> & Record<string, unknown>;
  return {
    outcome_id: r.outcome_id,
    claim_id: r.claim_id,
    denial_id: r.denial_id ?? undefined,
    payer_id: r.payer_id ?? (p.payer_id as string) ?? '',
    payer_name: (p.payer_name as string) ?? '',
    category: (p.category as DenialCategory) ?? 'contractual',
    workflow_owner: (p.workflow_owner as RecoveryOutcome['workflow_owner']) ?? 'unassigned',
    playbook_used: (p.playbook_used as DenialCategory) ?? undefined,
    resolution_type: r.resolution_type as ResolutionType,
    denied_amount_cents: Number(r.denied_amount_cents),
    recovered_amount_cents: Number(r.recovered_amount_cents),
    unrecovered_amount_cents: Number(r.unrecovered_amount_cents),
    denial_date: (p.denial_date as string) ?? r.resolution_date,
    resolution_date: r.resolution_date,
    days_to_resolution: Number(p.days_to_resolution ?? 0),
    predicted_recoverability_score: Number(p.predicted_recoverability_score ?? 0),
    notes: r.notes ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function outcomeToRow(o: RecoveryOutcome): Row {
  return {
    outcome_id: o.outcome_id,
    claim_id: o.claim_id,
    denial_id: o.denial_id ?? null,
    payer_id: o.payer_id ?? null,
    resolution_type: o.resolution_type,
    resolution_date: o.resolution_date,
    denied_amount_cents: o.denied_amount_cents,
    recovered_amount_cents: o.recovered_amount_cents,
    unrecovered_amount_cents: o.unrecovered_amount_cents,
    notes: o.notes ?? null,
    payload: {
      payer_name: o.payer_name,
      category: o.category,
      workflow_owner: o.workflow_owner,
      playbook_used: o.playbook_used,
      denial_date: o.denial_date,
      days_to_resolution: o.days_to_resolution,
      predicted_recoverability_score: o.predicted_recoverability_score,
    },
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
}

function notify() { window.dispatchEvent(new Event('clarity-outcomes')); }

let cache: RecoveryOutcome[] = [];
let loaded = false;
let seedAttempted = false;

export function getAllOutcomes(): RecoveryOutcome[] { return cache; }
export function _setOutcomeCache(next: RecoveryOutcome[]) { cache = next; loaded = true; }
export function isOutcomeCacheLoaded() { return loaded; }

export async function loadOutcomes(): Promise<RecoveryOutcome[]> {
  const { data, error } = await supabase
    .from('recovery_outcomes')
    .select('*')
    .order('resolution_date', { ascending: false });
  if (error) {
    console.error('[outcomes] load failed', error.message);
    return [];
  }
  const list = (data ?? []).map(r => rowToOutcome(r as never));
  cache = list; loaded = true;
  return list;
}

export async function upsertOutcome(o: RecoveryOutcome): Promise<void> {
  const row = outcomeToRow({ ...o, updated_at: new Date().toISOString() });
  const { error } = await supabase
    .from('recovery_outcomes')
    .upsert(row as never, { onConflict: 'outcome_id' });
  if (error) { console.error('[outcomes] upsert failed', error.message); return; }
  // Lineage event — outcome_recorded step in recovery chain.
  await appendLineageEvent({
    org_id: (row as any).org_id ?? null,
    claim_id: o.claim_id ?? null,
    outcome_id: o.outcome_id ?? null,
    event_type: 'outcome_recorded',
    event_summary: `Outcome recorded: ${o.resolution_type} — recovered $${(o.recovered_amount_cents / 100).toFixed(2)}`,
    payload: {
      outcome_id: o.outcome_id,
      resolution_type: o.resolution_type,
      recovered_cents: o.recovered_amount_cents,
      denied_cents: o.denied_amount_cents,
    },
  });
  await loadOutcomes();
  notify();
}

export async function deleteOutcome(id: string): Promise<void> {
  const { error } = await supabase.from('recovery_outcomes').delete().eq('outcome_id', id);
  if (error) { console.error('[outcomes] delete failed', error.message); return; }
  await loadOutcomes();
  notify();
}

function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000));
}

/**
 * Derive an initial outcome history from terminal claim states.
 * Honest derivation — no fabricated data.
 */
export function deriveOutcomesFromClaims(claims: Array<Claim & { intel: ClaimIntel }>): RecoveryOutcome[] {
  const out: RecoveryOutcome[] = [];
  const now = new Date().toISOString();

  for (const c of claims) {
    const intel = c.intel;
    const primary = intel.denial_events[0];
    if (!primary && intel.reimbursement_state !== 'written_off') continue;

    const denial_date = primary?.occurred_at ?? intel.submitted_at;
    const category: DenialCategory = primary?.category ?? 'contractual';
    const predicted = explainRecoverability(c).score;

    const decided = intel.appeals.filter(a => ['approved', 'denied', 'partial'].includes(a.status));
    for (const a of decided) {
      const recovered = a.amount_recovered_cents ?? 0;
      const resolution: ResolutionType =
        a.status === 'approved' ? 'appeal_won'
        : a.status === 'partial' ? 'recovered_partial'
        : 'appeal_lost';
      const resolution_date = a.decision_at ?? a.filed_at ?? now;
      out.push({
        outcome_id: `OUT-${a.appeal_id}`,
        claim_id: c.claim_id,
        denial_id: a.denial_id ?? primary?.denial_id,
        payer_id: intel.payer_id, payer_name: intel.payer_name,
        category, workflow_owner: intel.workflow_owner, playbook_used: category,
        resolution_type: resolution,
        denied_amount_cents: a.amount_in_dispute_cents,
        recovered_amount_cents: recovered,
        unrecovered_amount_cents: Math.max(0, a.amount_in_dispute_cents - recovered),
        denial_date, resolution_date,
        days_to_resolution: daysBetween(denial_date, resolution_date),
        predicted_recoverability_score: predicted,
        created_at: now, updated_at: now,
      });
    }

    if (decided.length === 0) {
      const last = intel.timeline[intel.timeline.length - 1]?.occurred_at ?? now;
      if (intel.reimbursement_state === 'paid' && primary) {
        const denied = primary.amount_cents;
        out.push(buildOutcome(c, 'corrected_and_paid', primary, denied, Math.min(intel.actual_reimbursement_cents, denied), denial_date, last, predicted, '-CORR'));
      } else if (intel.reimbursement_state === 'written_off') {
        const denied = primary?.amount_cents ?? intel.amount_at_risk_cents;
        out.push(buildOutcome(c, 'written_off', primary, denied, 0, denial_date, last, predicted, '-WO'));
      } else if (intel.reimbursement_state === 'partially_paid' && primary) {
        const denied = primary.amount_cents;
        out.push(buildOutcome(c, 'recovered_partial', primary, denied, Math.min(intel.actual_reimbursement_cents, denied), denial_date, last, predicted, '-PART'));
      }
    }
  }
  return out;
}

function buildOutcome(
  c: Claim & { intel: ClaimIntel },
  resolution: ResolutionType,
  primary: ClaimIntel['denial_events'][number] | undefined,
  denied: number, recovered: number,
  denial_date: string, resolution_date: string,
  predicted: number, suffix: string,
): RecoveryOutcome {
  const now = new Date().toISOString();
  const category: DenialCategory = primary?.category ?? 'contractual';
  return {
    outcome_id: `OUT-${c.claim_id}${suffix}`,
    claim_id: c.claim_id,
    denial_id: primary?.denial_id,
    payer_id: c.intel.payer_id, payer_name: c.intel.payer_name,
    category, workflow_owner: c.intel.workflow_owner, playbook_used: category,
    resolution_type: resolution,
    denied_amount_cents: denied,
    recovered_amount_cents: recovered,
    unrecovered_amount_cents: Math.max(0, denied - recovered),
    denial_date, resolution_date,
    days_to_resolution: daysBetween(denial_date, resolution_date),
    predicted_recoverability_score: predicted,
    created_at: now, updated_at: now,
  };
}

const SEED_KEY = 'clarity:outcomes:seeded:v2';
export async function seedOutcomesIfEmpty(claims: Array<Claim & { intel: ClaimIntel }>) {
  if (seedAttempted) return;
  seedAttempted = true;
  // Phase 12 — demo seeders gated; production orgs never receive derived outcomes.
  const { isDemoModeEnabled } = await import('@/lib/demo-flag');
  if (!isDemoModeEnabled()) { await loadOutcomes(); return; }
  if (localStorage.getItem(SEED_KEY)) { await loadOutcomes(); return; }

  const existing = await loadOutcomes();
  if (existing.length > 0) { localStorage.setItem(SEED_KEY, '1'); return; }

  const derived = deriveOutcomesFromClaims(claims);
  if (derived.length === 0) { localStorage.setItem(SEED_KEY, '1'); return; }

  const rows = derived.map(outcomeToRow);
  const { error } = await supabase.from('recovery_outcomes').upsert(rows as never, { onConflict: 'outcome_id' });
  if (error) { console.error('[outcomes] seed failed', error.message); seedAttempted = false; return; }
  localStorage.setItem(SEED_KEY, '1');
  await loadOutcomes();
  notify();
}

export async function resetOutcomes(): Promise<void> {
  const ids = cache.map(o => o.outcome_id);
  if (ids.length > 0) {
    const { error } = await supabase.from('recovery_outcomes').delete().in('outcome_id', ids);
    if (error) console.error('[outcomes] reset failed', error.message);
  }
  localStorage.removeItem(SEED_KEY);
  seedAttempted = false;
  cache = [];
  notify();
}
