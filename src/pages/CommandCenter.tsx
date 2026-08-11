import { useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useClarityData, formatCentsCompact, formatCents } from '@/hooks/use-clarity-data';
import { PageHeader, KpiStrip, Panel, EmptyState, ScrollBody } from '@/components/clarity/primitives';
import { AlertOctagon, TrendingDown, Gavel, ListChecks, Loader2, ArrowRight } from 'lucide-react';
import { CATEGORY_LABEL, QUEUE_LABEL } from '@/engine/denial-intelligence';
import { useOrg } from '@/hooks/use-org';

export default function CommandCenter() {
  const { data: claims, isLoading } = useClarityData();
  const { currentOrg, loading: orgLoading } = useOrg();

  // All hooks must be declared before any conditional returns (Rules of Hooks).
  const kpis = useMemo(() => {
    if (!claims) return null;
    const totalBilled = claims.reduce((s, c) => s + c.total_billed, 0);
    const totalAtRisk = claims.reduce((s, c) => s + c.intel.amount_at_risk_cents, 0);
    const totalPaid = claims.reduce((s, c) => s + c.intel.actual_reimbursement_cents, 0);
    const denialCount = claims.reduce((s, c) => s + c.intel.denial_events.length, 0);
    const appealCount = claims.reduce((s, c) => s + c.intel.appeals.length, 0);
    const escalated = claims.filter(c => c.intel.is_escalated).length;
    return { totalBilled, totalAtRisk, totalPaid, denialCount, appealCount, escalated };
  }, [claims]);

  const categoryBreakdown = useMemo(() => {
    if (!claims) return [];
    const m = new Map<string, { count: number; amount: number }>();
    for (const c of claims) {
      for (const d of c.intel.denial_events) {
        const cur = m.get(d.category) ?? { count: 0, amount: 0 };
        cur.count += 1; cur.amount += d.amount_cents;
        m.set(d.category, cur);
      }
    }
    return [...m.entries()].sort((a, b) => b[1].amount - a[1].amount);
  }, [claims]);

  const topRisks = useMemo(() => {
    if (!claims) return [];
    return [...claims]
      .filter(c => c.intel.amount_at_risk_cents > 0)
      .sort((a, b) => {
        const sevRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
        if (sevRank[a.intel.severity] !== sevRank[b.intel.severity]) return sevRank[a.intel.severity] - sevRank[b.intel.severity];
        return b.intel.amount_at_risk_cents - a.intel.amount_at_risk_cents;
      })
      .slice(0, 6);
  }, [claims]);

  // Role-based landing: analysts and viewers get their worklist, not the exec KPIs.
  if (!orgLoading && currentOrg) {
    if (currentOrg.role === 'analyst') return <Navigate to="/worklist" replace />;
    if (currentOrg.role === 'viewer')  return <Navigate to="/today"    replace />;
  }

  if (isLoading || !kpis) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Hydrating operational intelligence…
      </div>
    );
  }

  const maxCat = categoryBreakdown[0]?.[1].amount ?? 1;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Claim Clarity · Command Center"
        subtitle="Healthcare adjudication intelligence — deterministic decisions, auditable trace, replayable across payers."
      />
      <KpiStrip tiles={[
        { label: 'Billed (Period)',  value: formatCentsCompact(kpis.totalBilled) },
        { label: 'Collected',        value: formatCentsCompact(kpis.totalPaid),    tone: 'amount-positive' },
        { label: 'At Risk',          value: formatCentsCompact(kpis.totalAtRisk),  tone: 'amount-negative', sub: 'across open denials' },
        { label: 'Open Denials',     value: String(kpis.denialCount),               tone: 'text-status-denied' },
        { label: 'Appeals Active',   value: String(kpis.appealCount),               tone: 'text-status-cob' },
        { label: 'Escalations',      value: String(kpis.escalated),                 tone: 'text-status-pending' },
      ]} />

      <ScrollBody>
        <div className="grid grid-cols-3 gap-4 p-5">
          <div className="col-span-2 space-y-4">
            <Panel title="At-Risk Reimbursement by Denial Category">
              <div className="space-y-2.5">
                {categoryBreakdown.map(([cat, v]) => (
                  <div key={cat} className="grid grid-cols-[1fr_auto_120px] gap-3 items-center">
                    <div>
                      <div className="text-[12.5px] text-foreground">{CATEGORY_LABEL[cat as keyof typeof CATEGORY_LABEL] ?? cat}</div>
                      <div className="text-[10.5px] text-muted-foreground font-mono">{v.count} denial{v.count !== 1 ? 's' : ''}</div>
                    </div>
                    <div className="h-1.5 w-44 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-status-denied/60" style={{ width: `${(v.amount / maxCat) * 100}%` }} />
                    </div>
                    <div className="font-mono text-[12.5px] text-right tabular-nums text-foreground">{formatCents(v.amount)}</div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Top At-Risk Claims" action={<Link to="/denials" className="text-[11.5px] text-primary hover:underline flex items-center gap-1">Open Denial Intelligence <ArrowRight className="h-3 w-3" /></Link>}>
              <div className="divide-y -mx-4 -my-4">
                {topRisks.map(c => (
                  <Link key={c.claim_id} to={`/denials/${c.claim_id}`} className="grid grid-cols-[140px_1fr_140px_120px_100px] gap-3 items-center px-4 py-2.5 hover:bg-muted/40 transition-colors">
                    <span className="font-mono text-[12.5px] font-semibold text-foreground">{c.claim_id}</span>
                    <div className="min-w-0">
                      <div className="text-[12.5px] truncate text-foreground">{c.intel.payer_name}</div>
                      <div className="text-[10.5px] text-muted-foreground truncate">{c.provider_name}</div>
                    </div>
                    <span className="text-[11.5px] text-muted-foreground truncate">{c.intel.denial_events[0]?.root_cause ?? '—'}</span>
                    <span className="font-mono text-[12.5px] amount-negative text-right tabular-nums">{formatCents(c.intel.amount_at_risk_cents)}</span>
                    <span className="font-mono text-[11px] text-right text-muted-foreground">{c.intel.recoverability_score}% rec.</span>
                  </Link>
                ))}
              </div>
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Module Shortcuts">
              <div className="space-y-1">
                <ShortcutLink to="/denials"  icon={<AlertOctagon className="h-4 w-4" />} label="Denial Intelligence" hint={`${kpis.denialCount} open denials`} />
                <ShortcutLink to="/queues"   icon={<ListChecks className="h-4 w-4" />}   label="Work Queues"         hint="8 queues active" />
                <ShortcutLink to="/appeals"  icon={<Gavel className="h-4 w-4" />}        label="Appeals & Evidence"  hint={`${kpis.appealCount} in flight`} />
                <ShortcutLink to="/leak"     icon={<TrendingDown className="h-4 w-4" />} label="Revenue Leak"        hint={formatCentsCompact(kpis.totalAtRisk) + ' at risk'} />
              </div>
            </Panel>

            <Panel title="Engine Health">
              <div className="space-y-1.5 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Adjudication engine</span>
                  <span className="text-status-paid font-mono text-[11.5px]">OPERATIONAL</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Denial intelligence</span>
                  <span className="text-status-paid font-mono text-[11.5px]">OPERATIONAL</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Trace persistence</span>
                  <span className="text-status-paid font-mono text-[11.5px]">LIVE</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">EDI ingestion</span>
                  <span className="text-status-pending font-mono text-[11.5px]">SCAFFOLD</span>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function ShortcutLink({ to, icon, label, hint }: { to: string; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-muted/60 transition-colors">
      <div className="h-7 w-7 rounded bg-accent text-accent-foreground flex items-center justify-center">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium text-foreground">{label}</div>
        <div className="text-[10.5px] text-muted-foreground font-mono">{hint}</div>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
    </Link>
  );
}
