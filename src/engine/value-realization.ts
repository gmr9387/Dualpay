/**
 * Value Realization Engine — Phase 11
 *
 * Quantifies total dollars at risk vs recovered, expected future
 * recovery (recoverability-weighted open AR), and period-on-period
 * deltas.  Reuses denial-intelligence scoring already on each claim
 * — no second scoring model.
 */
import type { ClarityClaim } from '@/hooks/use-clarity-data';
import type { RecoveryOutcome } from '@/types/outcomes';
import { RECOVERED_RESOLUTIONS } from '@/types/outcomes';
import type { DenialCategory } from '@/types/clarity';
import { CATEGORY_LABEL } from '@/engine/outcome-analytics';

export const MIN_SAMPLE = 5;

export interface ValueRealization {
  total_at_risk_cents: number;
  total_recovered_cents: number;
  total_denied_cents: number;
  recovery_rate: number;
  expected_future_recovery_cents: number;
  open_recoverable_cents: number;
  outcome_count: number;
  insufficient: boolean;
}

export function computeValueRealization(
  claims: ClarityClaim[], outcomes: RecoveryOutcome[],
): ValueRealization {
  const atRisk = claims.reduce((s, c) => s + c.intel.amount_at_risk_cents, 0);
  const denied = outcomes.reduce((s, o) => s + o.denied_amount_cents, 0);
  const recovered = outcomes.reduce((s, o) => s + o.recovered_amount_cents, 0);

  const open = claims.filter(c =>
    !['paid', 'resolved', 'written_off'].includes(c.intel.reimbursement_state),
  );
  const expected = open.reduce(
    (s, c) => s + Math.round(c.intel.amount_at_risk_cents * (c.intel.recoverability_score / 100)),
    0,
  );
  const openRecoverable = open
    .filter(c => c.intel.recoverability_score >= 50)
    .reduce((s, c) => s + c.intel.amount_at_risk_cents, 0);

  return {
    total_at_risk_cents: atRisk,
    total_recovered_cents: recovered,
    total_denied_cents: denied,
    recovery_rate: denied ? recovered / denied : 0,
    expected_future_recovery_cents: expected,
    open_recoverable_cents: openRecoverable,
    outcome_count: outcomes.length,
    insufficient: outcomes.length < MIN_SAMPLE,
  };
}

export interface PeriodValue {
  period: string;            // YYYY-MM
  recovered_cents: number;
  denied_cents: number;
  recovery_rate: number;
  count: number;
}

export function recoveredByMonth(outcomes: RecoveryOutcome[]): PeriodValue[] {
  const m = new Map<string, RecoveryOutcome[]>();
  for (const o of outcomes) {
    const d = new Date(o.resolution_date);
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(o);
  }
  return [...m.entries()].map(([period, arr]) => {
    const denied = arr.reduce((s, o) => s + o.denied_amount_cents, 0);
    const recovered = arr.reduce((s, o) => s + o.recovered_amount_cents, 0);
    return { period, recovered_cents: recovered, denied_cents: denied,
      recovery_rate: denied ? recovered / denied : 0, count: arr.length };
  }).sort((a, b) => a.period.localeCompare(b.period));
}

export interface CategoryValue {
  category: DenialCategory;
  label: string;
  recovered_cents: number;
  unrecovered_cents: number;
  count: number;
}

export function recoveredByCategory(outcomes: RecoveryOutcome[]): CategoryValue[] {
  const m = new Map<DenialCategory, RecoveryOutcome[]>();
  for (const o of outcomes) {
    if (!m.has(o.category)) m.set(o.category, []);
    m.get(o.category)!.push(o);
  }
  return [...m.entries()].map(([category, arr]) => ({
    category, label: CATEGORY_LABEL[category] ?? String(category),
    recovered_cents: arr.reduce((s, o) => s + o.recovered_amount_cents, 0),
    unrecovered_cents: arr.reduce((s, o) => s + o.unrecovered_amount_cents, 0),
    count: arr.length,
  })).sort((a, b) => b.recovered_cents - a.recovered_cents);
}

export interface PayerValue {
  payer_id: string;
  payer_name: string;
  recovered_cents: number;
  unrecovered_cents: number;
  count: number;
}

export function recoveredByPayer(outcomes: RecoveryOutcome[]): PayerValue[] {
  const m = new Map<string, RecoveryOutcome[]>();
  for (const o of outcomes) {
    if (!m.has(o.payer_id)) m.set(o.payer_id, []);
    m.get(o.payer_id)!.push(o);
  }
  return [...m.entries()].map(([payer_id, arr]) => ({
    payer_id, payer_name: arr[0].payer_name,
    recovered_cents: arr.reduce((s, o) => s + o.recovered_amount_cents, 0),
    unrecovered_cents: arr.reduce((s, o) => s + o.unrecovered_amount_cents, 0),
    count: arr.length,
  })).sort((a, b) => b.recovered_cents - a.recovered_cents);
}

/**
 * Deterministic executive narrative.  Returns null if insufficient
 * history — the UI must render "Insufficient Outcome History".
 */
export function buildNarrative(
  claims: ClarityClaim[], outcomes: RecoveryOutcome[],
): string | null {
  if (outcomes.length < MIN_SAMPLE) return null;

  const monthly = recoveredByMonth(outcomes);
  const current = monthly[monthly.length - 1];
  const previous = monthly[monthly.length - 2];
  const vr = computeValueRealization(claims, outcomes);

  const fmt = (c: number) => {
    const d = Math.abs(c) / 100;
    if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
    if (d >= 1_000) return `$${(d / 1_000).toFixed(1)}K`;
    return `$${d.toFixed(0)}`;
  };

  const period = current ? new Date(`${current.period}-01T00:00:00Z`)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'This period';

  let delta = '';
  if (current && previous && previous.recovered_cents > 0) {
    const pct = ((current.recovered_cents - previous.recovered_cents) / previous.recovered_cents) * 100;
    const dir = pct >= 0 ? 'improved' : 'declined';
    delta = ` Recovery performance ${dir} by ${Math.abs(pct).toFixed(0)}% vs the previous period.`;
  }

  return `In ${period} DualPay tracked ${fmt(vr.total_at_risk_cents)} at risk and ` +
    `recovered ${fmt(current?.recovered_cents ?? 0)} against ${fmt(current?.denied_cents ?? 0)} in denials ` +
    `(${((current?.recovery_rate ?? 0) * 100).toFixed(0)}% recovery rate).${delta} ` +
    `Expected future recovery from open AR: ${fmt(vr.expected_future_recovery_cents)}.`;
}
