/**
 * Decision Transparency Center
 *
 * Single surface where every recommendation, score, and forecast can
 * be inspected against its source data. Index view lists per-claim
 * decision packages, executive trust metrics, and forecast transparency.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ShieldCheck, FileSearch, Gavel, Building2, TrendingUp } from 'lucide-react';
import { useClarityData, formatCents, formatCentsCompact, type ClarityClaim } from '@/hooks/use-clarity-data';
import { PageHeader, KpiStrip, ScrollBody, Panel, RowLink, RecoverabilityBar } from '@/components/clarity/primitives';
import { ReadinessBadge, InsufficientEvidence, BasisList, FactorRow, SectionLabel } from '@/components/clarity/transparency';
import { scoreEvidenceReadiness } from '@/engine/evidence-readiness';
import { scoreAppealReadiness } from '@/engine/appeal-readiness';
import { buildTrustReport } from '@/engine/trust-metrics';
import { checkForecastSufficiency } from '@/engine/sufficiency';
import { buildForecast } from '@/engine/forecasting';

export default function TransparencyCenter() {
  const { data: claims, isLoading } = useClarityData();
  const trust       = useMemo(() => claims ? buildTrustReport(claims) : null, [claims]);
  const forecast    = useMemo(() => claims ? buildForecast(claims) : null, [claims]);
  const forecastSuf = useMemo(() => claims ? checkForecastSufficiency(claims) : null, [claims]);

  const rows = useMemo(() => {
    if (!claims) return [];
    return claims
      .filter(c => c.intel.denial_events.length > 0)
      .map(c => {
        const ev = scoreEvidenceReadiness(c, claims);
        const ap = scoreAppealReadiness(c, claims);
        return { c, ev, ap };
      })
      .sort((a, b) => b.c.intel.amount_at_risk_cents - a.c.intel.amount_at_risk_cents)
      .slice(0, 30);
  }, [claims]);

  if (isLoading || !claims || !trust || !forecast || !forecastSuf) {
    return <div className="h-full flex items-center justify-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading transparency surfaces…</div>;
  }

  const readyCount    = rows.filter(r => r.ap.tier === 'READY').length;
  const reviewCount   = rows.filter(r => r.ap.tier === 'NEEDS_REVIEW').length;
  const notReadyCount = rows.filter(r => r.ap.tier === 'NOT_READY').length;
  const insufCount    = rows.filter(r => r.ap.tier === 'INSUFFICIENT').length;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Decision Transparency Center"
        subtitle="Every recommendation, score, and forecast — traceable to its source data."
      />
      <KpiStrip tiles={[
        { label: 'Decision packages',  value: rows.length.toString(),     sub: 'denied claims with active recommendations' },
        { label: 'Appeal-ready',       value: readyCount.toString(),       tone: 'text-status-paid' },
        { label: 'Needs review',       value: reviewCount.toString(),      tone: 'text-status-pending' },
        { label: 'Not ready',          value: notReadyCount.toString(),    tone: 'text-status-denied' },
        { label: 'Insufficient evidence', value: insufCount.toString(),    tone: 'text-muted-foreground' },
      ]} />

      <ScrollBody>
        <div className="grid grid-cols-3 gap-4 p-5">
          <div className="col-span-2 space-y-4">
            <Panel title="Decision Packages" action={<span className="text-[10.5px] font-mono text-muted-foreground">{rows.length} claims · evidence + appeal readiness</span>} dense>
              {rows.length === 0 ? (
                <div className="px-4 py-6 text-[12px] text-muted-foreground italic">No actionable claims with denials in the dataset.</div>
              ) : (
                <div className="divide-y">
                  <div className="grid grid-cols-[1fr_120px_120px_140px_100px] gap-3 px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <span>Claim · payer</span>
                    <span>Evidence</span>
                    <span>Appeal</span>
                    <span>Recoverability</span>
                    <span className="text-right">At Risk</span>
                  </div>
                  {rows.map(({ c, ev, ap }) => (
                    <Link
                      key={c.claim_id}
                      to={`/transparency/${c.claim_id}`}
                      className="grid grid-cols-[1fr_120px_120px_140px_100px] gap-3 px-4 py-2.5 items-center hover:bg-muted/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-[12px] font-semibold text-foreground">{c.claim_id}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{c.intel.payer_name}</div>
                      </div>
                      <ReadinessBadge tier={ev.tier} />
                      <ReadinessBadge tier={ap.tier} />
                      <RecoverabilityBar score={c.intel.recoverability_score} />
                      <span className="font-mono text-[12px] text-right tabular-nums amount-negative">{formatCents(c.intel.amount_at_risk_cents)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Forecast Transparency" action={<TrendingUp className="h-4 w-4 text-muted-foreground" />}>
              {!forecastSuf.sufficient ? (
                <InsufficientEvidence title="Forecast Insufficient Evidence" check={forecastSuf} />
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3 text-[12px]">
                    <Stat label="Projected"  value={formatCents(forecast.total_expected_recovery_cents)} tone="amount-positive" />
                    <Stat label="At risk"    value={formatCents(forecast.total_at_risk_cents)}           tone="amount-negative" />
                    <Stat label="Rate"       value={`${(forecast.expected_recovery_rate * 100).toFixed(1)}%`} />
                  </div>
                  <div>
                    <SectionLabel>Contributing categories</SectionLabel>
                    <div className="flex flex-wrap gap-1.5">
                      {topCategories(claims).map(([cat, count]) => (
                        <span key={cat} className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-card border text-foreground">
                          {cat} · {count}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <SectionLabel>Underlying assumptions</SectionLabel>
                    <BasisList items={forecast.assumptions} />
                  </div>
                  <div className="rounded border border-dashed border-border bg-muted/20 p-2.5 text-[11.5px] text-muted-foreground">
                    <span className="font-semibold text-foreground">Forecast tracking:</span>{' '}
                    Projected = <span className="font-mono">{formatCentsCompact(forecast.total_expected_recovery_cents)}</span>.
                    Actual recovered and variance become available after the first month of completed projections.
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Executive Trust Metrics" action={<ShieldCheck className="h-4 w-4 text-primary" />}>
              <div className="space-y-2.5">
                {trust.metrics.map(m => (
                  <div key={m.key} className="rounded border bg-muted/30 p-2.5">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[12px] font-medium text-foreground">{m.label}</span>
                      {m.value === null
                        ? <span className="pill border bg-muted text-muted-foreground border-border">Insufficient</span>
                        : <span className="font-mono text-[13px] tabular-nums text-foreground">{m.value}{m.unit}</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground leading-snug">{m.basis}</div>
                    {m.value !== null && m.denominator > 0 && (
                      <div className="text-[10.5px] font-mono text-muted-foreground mt-1">
                        {m.numerator}/{m.denominator} · sources: {m.sources.join(', ') || '—'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="What This Surface Guarantees">
              <ul className="space-y-2 text-[11.5px] text-muted-foreground">
                <Guarantee icon={<FileSearch className="h-3.5 w-3.5" />} text="Every score reproduces from claim data on file — no hidden ML." />
                <Guarantee icon={<Gavel className="h-3.5 w-3.5" />}      text="Appeal readiness exposes documentation, payer, and deadline factors with their weights." />
                <Guarantee icon={<Building2 className="h-3.5 w-3.5" />}  text="Payer ratings show inputs, time periods, and sample counts." />
                <Guarantee icon={<TrendingUp className="h-3.5 w-3.5" />} text="Forecasts decompose into per-bucket drivers and assumptions; missing history shows Insufficient Evidence." />
              </ul>
            </Panel>
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-[14px] font-semibold tabular-nums mt-0.5 ${tone ?? 'text-foreground'}`}>{value}</div>
    </div>
  );
}

function Guarantee({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="text-primary mt-0.5">{icon}</span>
      <span className="text-foreground">{text}</span>
    </li>
  );
}

function topCategories(claims: ClarityClaim[]): Array<[string, number]> {
  const list = claims ?? [];
  const map = new Map<string, number>();
  for (const c of list) for (const d of c.intel.denial_events) {
    map.set(d.category, (map.get(d.category) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
}
