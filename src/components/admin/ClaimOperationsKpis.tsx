/**
 * Claim Operations dashboard KPIs — enterprise-grade summary across the
 * Claim Clarity adjudication queue. Presentation only; derives from the
 * existing AdjudicationRun + Claim shapes without altering engine output.
 *
 * `totalCount`/`needsReviewCount` are real org-wide counts (cheap SQL
 * COUNTs, independent of pagination). The other tiles need a claim's
 * status *and* its run together, which pagination can't give cheaply
 * without a dedicated SQL aggregate -- so `kpiClaims`/`kpiRuns` are a
 * bounded, recent, org-wide *sample* (see loadRecentRunsForKpis), not
 * the current page and not an audit-grade total. Real for the volumes
 * this app runs at today; documented rather than silently exact.
 */
import type { Claim, AdjudicationRun } from '@/types/claim';
import type { TraceObject } from '@/types/trace';
import type { Case } from '@/types/case';

interface AdjResult {
  claimId: string;
  run: AdjudicationRun;
  trace: TraceObject;
}

interface Props {
  totalCount: number;
  needsReviewCount: number;
  kpiClaims: Claim[];
  kpiRuns: AdjResult[];
  cases: Case[];
}

interface Tile {
  label: string;
  value: string;
  tone?: string;
  sub?: string;
}

export function ClaimOperationsKpis({ totalCount, needsReviewCount, kpiClaims, kpiRuns, cases }: Props) {
  const linkedCases = cases.filter(k => k.claim_ids.length > 0).length;

  const autoAdjudicated = kpiRuns.filter(r => {
    const claim = kpiClaims.find(c => c.claim_id === r.claimId);
    if (!claim) return false;
    if (claim.status !== 'PAID' && claim.status !== 'ADJUDICATED') return false;
    return r.run.line_results.every(lr => lr.status !== 'denied');
  }).length;

  const cobConflicts = kpiRuns.filter(r =>
    r.run.line_results.some(lr => lr.cob_allocations.length > 0),
  ).length;

  const appealReady = kpiClaims.filter(c => {
    if (c.status !== 'DENIED') return false;
    const r = kpiRuns.find(x => x.claimId === c.claim_id);
    return !!r && r.trace.rule_firings.length > 0 && r.trace.math_steps.length > 0;
  }).length;

  const traceCoverage = kpiClaims.length === 0 ? 0 : Math.round((kpiRuns.length / kpiClaims.length) * 100);

  const tiles: Tile[] = [
    { label: 'Claims Processed', value: totalCount.toLocaleString() },
    { label: 'Cases Linked', value: linkedCases.toLocaleString(), sub: 'N→1 case grouping' },
    { label: 'Auto-Adjudicated', value: autoAdjudicated.toLocaleString(), tone: 'amount-positive', sub: 'recent sample' },
    { label: 'Needs Review', value: needsReviewCount.toLocaleString(), tone: needsReviewCount ? 'text-status-pending' : '' },
    { label: 'COB Conflicts', value: cobConflicts.toLocaleString(), tone: cobConflicts ? 'text-status-cob' : '', sub: 'recent sample' },
    { label: 'Appeal-Ready', value: appealReady.toLocaleString(), tone: appealReady ? 'text-status-denied' : '', sub: 'recent sample' },
    { label: 'Avg Processing', value: 'Insufficient History', sub: 'awaiting volume' },
    { label: 'Trace Coverage', value: `${traceCoverage}%`, tone: traceCoverage === 100 ? 'amount-positive' : '', sub: 'recent sample' },
  ];

  return (
    <div className="flex items-stretch border-b bg-card">
      {tiles.map(t => (
        <div key={t.label} className="kpi flex-1">
          <div className="kpi-label">{t.label}</div>
          <div className={`kpi-value ${t.tone ?? ''}`}>{t.value}</div>
          {t.sub && <div className="text-[10.5px] font-mono text-muted-foreground/80 mt-0.5">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}
