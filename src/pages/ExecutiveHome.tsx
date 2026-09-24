/**
 * Executive Home — Value Realization headline.
 * Phase 11.  Composes existing engines (no new scoring).
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, BarChart3, TrendingUp, Trophy, Users } from 'lucide-react';
import { useClarityData, formatCentsCompact } from '@/hooks/use-clarity-data';
import { useOutcomes } from '@/hooks/use-outcomes';
import { PageHeader, KpiStrip, ScrollBody, Panel, EmptyState } from '@/components/clarity/primitives';
import {
  computeValueRealization, buildNarrative, recoveredByMonth,
} from '@/engine/value-realization';
import { rankPlaybooks } from '@/engine/playbook-effectiveness';
import { buildPayerScorecards } from '@/engine/payer-performance';
import { headlineMetrics } from '@/engine/outcome-analytics';

export default function ExecutiveHome() {
  const { data: claims, isLoading } = useClarityData();
  const { outcomes, loading } = useOutcomes();

  const view = useMemo(() => {
    if (!claims) return null;
    const value = computeValueRealization(claims, outcomes);
    const head = headlineMetrics(outcomes);
    const narrative = buildNarrative(claims, outcomes);
    const monthly = recoveredByMonth(outcomes);
    const playbooks = rankPlaybooks(outcomes).filter(p => !p.insufficient).slice(0, 3);
    const payers = buildPayerScorecards(claims, outcomes).slice(0, 5);
    const topOpportunity = [...payers].sort((a, b) => b.total_at_risk_cents - a.total_at_risk_cents)[0];
    const underpaymentRecovered = outcomes
      .filter(o => o.category === 'underpayment')
      .reduce((s, o) => s + o.recovered_amount_cents, 0);
    return { value, head, narrative, monthly, playbooks, payers, topOpportunity, underpaymentRecovered };
  }, [claims, outcomes]);

  if (isLoading || loading || !view) {
    return <div className="h-full flex items-center justify-center text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading executive intelligence…
    </div>;
  }

  const { value, head, narrative, monthly, playbooks, payers, topOpportunity, underpaymentRecovered } = view;
  const maxRecovered = Math.max(1, ...monthly.map(m => m.recovered_cents));

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Executive Intelligence"
        subtitle="Value realized by DualPay — recovery, leverage, and operational ROI."
      />
      <KpiStrip tiles={[
        { label: 'Dollars At Risk',     value: formatCentsCompact(value.total_at_risk_cents),       tone: 'amount-negative' },
        { label: 'Dollars Recovered',   value: formatCentsCompact(value.total_recovered_cents),     tone: 'amount-positive' },
        { label: 'Recovery Rate',       value: head.insufficient ? '—' : `${(head.recovery_rate * 100).toFixed(1)}%`, tone: 'text-status-paid' },
        { label: 'Avg Days To Recovery',value: head.insufficient ? '—' : `${head.avg_days_to_resolution.toFixed(0)}d` },
        { label: 'Appeal Success',      value: head.insufficient ? '—' : `${(head.appeal_success_rate * 100).toFixed(0)}%`, tone: 'text-status-cob' },
        { label: 'Expected Future',     value: formatCentsCompact(value.expected_future_recovery_cents), tone: 'text-primary' },
      ]} />

      <ScrollBody>
        <div className="grid grid-cols-3 gap-4 p-5">
          <div className="col-span-2 space-y-4">
            <Panel title="Executive Narrative">
              {narrative ? (
                <p className="text-[13px] leading-relaxed text-foreground">{narrative}</p>
              ) : (
                <div className="text-[12.5px] text-muted-foreground">
                  <b className="text-foreground">Insufficient Outcome History.</b>{' '}
                  At least 5 logged outcomes are required to generate a narrative.
                  Log resolutions in the <Link to="/outcomes" className="text-primary hover:underline">Outcome Log</Link> to enable this view.
                </div>
              )}
            </Panel>

            <Panel title="Recovered Dollars by Month" action={
              <Link to="/executive/value" className="text-[11.5px] text-primary hover:underline">Open value module</Link>
            }>
              {monthly.length === 0 ? (
                <EmptyState title="No outcome history" body="Log recoveries to see month-over-month trend." />
              ) : (
                <div className="space-y-2">
                  {monthly.slice(-6).map(m => (
                    <div key={m.period} className="grid grid-cols-[80px_1fr_120px] gap-3 items-center">
                      <span className="font-mono text-[11.5px] text-muted-foreground">{m.period}</span>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-status-paid/70" style={{ width: `${(m.recovered_cents / maxRecovered) * 100}%` }} />
                      </div>
                      <span className="font-mono text-[12.5px] text-right tabular-nums amount-positive">{formatCentsCompact(m.recovered_cents)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Top Playbooks by Recovery Rate" action={
              <Link to="/executive/playbooks" className="text-[11.5px] text-primary hover:underline">All playbooks</Link>
            }>
              {playbooks.length === 0 ? (
                <div className="text-[12.5px] text-muted-foreground">Insufficient Outcome History.</div>
              ) : (
                <div className="divide-y -my-4">
                  {playbooks.map(p => (
                    <div key={p.playbook} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-foreground">{p.label}</div>
                        <div className="text-[10.5px] font-mono text-muted-foreground">{p.usage_count} runs · {p.avg_resolution_days.toFixed(0)}d avg</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-[13px] amount-positive">{(p.recovery_rate * 100).toFixed(0)}%</div>
                        <div className="text-[10.5px] font-mono text-muted-foreground">{formatCentsCompact(p.total_recovered_cents)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Top Payer Opportunity">
              {topOpportunity ? (
                <Link to="/executive/payers" className="block rounded border bg-muted/30 p-3 hover:bg-muted/60">
                  <div className="text-[13px] font-semibold text-foreground">{topOpportunity.payer_name}</div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-[11px] font-mono">
                    <Row label="At risk"   value={formatCentsCompact(topOpportunity.total_at_risk_cents)} tone="amount-negative" />
                    <Row label="Recovered" value={formatCentsCompact(topOpportunity.total_collected_cents)} tone="amount-positive" />
                    <Row label="Denial %"  value={`${(topOpportunity.denial_rate * 100).toFixed(0)}%`} />
                    <Row label="Underpay %" value={`${(topOpportunity.underpayment_rate * 100).toFixed(0)}%`} />
                  </div>
                </Link>
              ) : <div className="text-[12.5px] text-muted-foreground">No payer data.</div>}
            </Panel>

            <Panel title="Underpayment Recovery">
              <div className="text-[20px] font-semibold amount-positive font-mono">{formatCentsCompact(underpaymentRecovered)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Recovered from underpayment outcomes</div>
            </Panel>

            <Panel title="Drilldowns">
              <div className="space-y-1.5">
                <NavCard to="/executive/recovery" icon={<TrendingUp className="h-3.5 w-3.5" />} label="Recovery Attribution" sub="By category, owner, action" />
                <NavCard to="/executive/payers"   icon={<Users className="h-3.5 w-3.5" />} label="Payer Scorecards" sub="Performance & opportunity" />
                <NavCard to="/executive/playbooks"icon={<Trophy className="h-3.5 w-3.5" />} label="Playbook Effectiveness" sub="Which workflows work" />
                <NavCard to="/executive/value"    icon={<BarChart3 className="h-3.5 w-3.5" />} label="Value Realization" sub="Monthly + lifetime ROI" />
              </div>
            </Panel>

            <div className="rounded border bg-card p-3 text-[11px] text-muted-foreground leading-snug">
              Every metric here is computed live from persisted outcomes, claims, and ops events.
              Slices with fewer than 5 outcomes are marked <i>insufficient</i> — never fabricated.
            </div>
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${tone ?? 'text-foreground'}`}>{value}</span>
    </div>
  );
}

function NavCard({ to, icon, label, sub }: { to: string; icon: React.ReactNode; label: string; sub: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 rounded border bg-muted/30 px-2.5 py-2 hover:bg-muted/60 transition-colors">
      <span className="text-primary">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-foreground">{label}</div>
        <div className="text-[10.5px] text-muted-foreground">{sub}</div>
      </div>
    </Link>
  );
}
