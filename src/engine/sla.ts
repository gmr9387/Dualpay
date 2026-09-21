/**
 * SLA Engine — deterministic, severity-driven SLA windows.
 *
 * Each denial severity has a "warning" and "breach" horizon measured
 * from the claim's submission / last-action timestamp.  Returns an
 * explainable status object so the UI can render badges, heatmaps,
 * and breach trends without recomputing the rules.
 */
import type { Claim } from '@/types/claim';
import type { ClaimIntel, DenialSeverity } from '@/types/clarity';

export type SlaState = 'healthy' | 'warning' | 'breached';

export interface SlaRule {
  warning_hours: number;
  breach_hours: number;
}

export const SLA_RULES: Record<DenialSeverity, SlaRule> = {
  critical: { warning_hours: 24,  breach_hours: 48 },
  high:     { warning_hours: 72,  breach_hours: 120 },   // 3d / 5d
  medium:   { warning_hours: 168, breach_hours: 240 },   // 7d / 10d
  low:      { warning_hours: 336, breach_hours: 504 },   // 14d / 21d
};

export const SLA_LABEL: Record<DenialSeverity, string> = {
  critical: '24h warn / 48h breach',
  high:     '3d warn / 5d breach',
  medium:   '7d warn / 10d breach',
  low:      '14d warn / 21d breach',
};

export interface SlaStatus {
  state: SlaState;
  severity: DenialSeverity;
  age_hours: number;
  warning_hours: number;
  breach_hours: number;
  hours_to_warning: number;   // negative when already past
  hours_to_breach: number;    // negative when already breached
  rationale: string;
}

type C = Claim & { intel: ClaimIntel };

function lastActionAt(claim: C): number {
  // Most-recent timeline event, fallback to submitted_at
  const t = claim.intel.timeline;
  const last = t.length ? t[t.length - 1].occurred_at : claim.intel.submitted_at;
  return new Date(last).getTime();
}

export function evaluateSla(claim: C, now: number = Date.now()): SlaStatus {
  const sev = claim.intel.severity;
  const rule = SLA_RULES[sev];
  const ageMs = now - lastActionAt(claim);
  const age_hours = Math.max(0, Math.round(ageMs / 3_600_000));
  const hours_to_warning = rule.warning_hours - age_hours;
  const hours_to_breach = rule.breach_hours - age_hours;

  let state: SlaState = 'healthy';
  if (age_hours >= rule.breach_hours) state = 'breached';
  else if (age_hours >= rule.warning_hours) state = 'warning';

  const rationale =
    state === 'breached'
      ? `Past ${rule.breach_hours}h SLA for ${sev} (age ${age_hours}h).`
      : state === 'warning'
        ? `Within warning window — ${hours_to_breach}h until breach.`
        : `Healthy — ${hours_to_warning}h until warning.`;

  return { state, severity: sev, age_hours, warning_hours: rule.warning_hours, breach_hours: rule.breach_hours, hours_to_warning, hours_to_breach, rationale };
}

export interface SlaSummary {
  healthy: number;
  warning: number;
  breached: number;
  breach_at_risk_cents: number;
  warning_at_risk_cents: number;
  by_severity: Record<DenialSeverity, { healthy: number; warning: number; breached: number }>;
  by_owner: Array<{ owner: string; healthy: number; warning: number; breached: number; at_risk_cents: number }>;
}

export function summarizeSla(claims: C[], assignments: Record<string, { assignee?: string | null }>): SlaSummary {
  const bySeverity: SlaSummary['by_severity'] = {
    critical: { healthy: 0, warning: 0, breached: 0 },
    high:     { healthy: 0, warning: 0, breached: 0 },
    medium:   { healthy: 0, warning: 0, breached: 0 },
    low:      { healthy: 0, warning: 0, breached: 0 },
  };
  const ownerMap = new Map<string, { healthy: number; warning: number; breached: number; at_risk_cents: number }>();
  let healthy = 0, warning = 0, breached = 0, breachRisk = 0, warnRisk = 0;

  for (const c of claims) {
    if (c.intel.reimbursement_state === 'paid' || c.intel.reimbursement_state === 'resolved') continue;
    const s = evaluateSla(c);
    bySeverity[s.severity][s.state] += 1;
    if (s.state === 'healthy')  healthy++;
    if (s.state === 'warning')  { warning++;  warnRisk  += c.intel.amount_at_risk_cents; }
    if (s.state === 'breached') { breached++; breachRisk += c.intel.amount_at_risk_cents; }

    const owner = assignments[c.claim_id]?.assignee ?? 'Unassigned';
    const o = ownerMap.get(owner) ?? { healthy: 0, warning: 0, breached: 0, at_risk_cents: 0 };
    o[s.state] += 1;
    if (s.state !== 'healthy') o.at_risk_cents += c.intel.amount_at_risk_cents;
    ownerMap.set(owner, o);
  }

  const by_owner = [...ownerMap.entries()]
    .map(([owner, v]) => ({ owner, ...v }))
    .sort((a, b) => (b.breached - a.breached) || (b.at_risk_cents - a.at_risk_cents));

  return { healthy, warning, breached, breach_at_risk_cents: breachRisk, warning_at_risk_cents: warnRisk, by_severity: bySeverity, by_owner };
}
