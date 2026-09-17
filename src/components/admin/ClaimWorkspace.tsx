import { useState } from 'react';
import type { Claim, AdjudicationRun } from '@/types/claim';
import type { TraceObject } from '@/types/trace';
import type { Case, CaseEvent } from '@/types/case';
import type { MemberAccumulators, ContractTerms, PlanBenefits, PriorPayerOutcome } from '@/types/claim';
import { AdjudicationPanel } from './AdjudicationPanel';
import { TraceViewer } from './TraceViewer';
import { CasePanel } from './CasePanel';
import { StateDiagram } from './StateDiagram';
import { RunSummaryPanel } from './RunSummaryPanel';
import { AuditReadinessPanel } from './AuditReadinessPanel';
import { NucleusVerificationPanel } from './NucleusVerificationPanel';
import { CaseLinkingPanel } from './CaseLinkingPanel';
import { FileText, Layers, Network, Cpu, GitBranch, Briefcase, Printer, Download, MoreHorizontal, ArrowRight } from 'lucide-react';

interface AdjResult {
  claimId: string;
  run: AdjudicationRun;
  trace: TraceObject;
}

interface ClaimWorkspaceProps {
  claim: Claim;
  result: AdjResult;
  caseData: Case | null;
  caseEvents: CaseEvent[];
  claims: Claim[];
  adjResults: AdjResult[];
  accumulators: Record<string, MemberAccumulators>;
  contract: ContractTerms;
  plan: PlanBenefits;
  priorOutcomes: PriorPayerOutcome[];
  onSelectClaim: (id: string) => void;
}

type TabId = 'summary' | 'lines' | 'cob' | 'trace' | 'state' | 'case';

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ClaimWorkspace(props: ClaimWorkspaceProps) {
  const { claim, result, caseData, caseEvents, claims, adjResults, accumulators, contract, plan, priorOutcomes, onSelectClaim } = props;
  const [tab, setTab] = useState<TabId>('summary');

  const hasCOB = result.run.line_results.some(lr => lr.cob_allocations.length > 0);

  const tabs: { id: TabId; label: string; icon: typeof FileText; disabled?: boolean }[] = [
    { id: 'summary', label: 'Summary',       icon: FileText },
    { id: 'lines',   label: 'Service Lines', icon: Layers },
    { id: 'cob',     label: 'COB',           icon: Network, disabled: !hasCOB },
    { id: 'trace',   label: 'Trace',         icon: Cpu },
    { id: 'state',   label: 'State Machine', icon: GitBranch },
    { id: 'case',    label: 'Case',          icon: Briefcase, disabled: !caseData },
  ];

  return (
    <div className="flex flex-col h-full bg-surface-0 min-w-0">
      {/* Claim header */}
      <div className="px-6 pt-5 pb-3 border-b bg-card">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <h1 className="text-[18px] font-semibold tracking-tight text-foreground">{claim.claim_id}</h1>
              <span className={
                claim.status === 'PAID' || claim.status === 'ADJUDICATED' ? 'status-paid'
                : claim.status === 'DENIED' ? 'status-denied'
                : claim.status === 'COB_ROUTED' || claim.status === 'AWAITING_PRIMARY_EOB' ? 'status-cob'
                : claim.status === 'PENDED' || claim.status === 'IN_ADJUDICATION' ? 'status-pending'
                : 'status-adjusted'
              }>
                {claim.status.replace(/_/g, ' ')}
              </span>
              {hasCOB && <span className="status-cob">COB</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted-foreground">
              <Field label="Member"   value={claim.member_id} mono />
              <Field label="Provider" value={`${claim.provider_name} · NPI ${claim.provider_npi}`} />
              {claim.facility_name && <Field label="Facility" value={claim.facility_name} />}
              <Field label="Service"  value={`${claim.service_date_from} → ${claim.service_date_to}`} mono />
              <Field label="Type"     value={claim.claim_type} />
              <Field label="Run"      value={`${result.run.run_id.slice(0, 18)}…`} mono />
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ToolbarBtn icon={Printer} label="Print EOB" />
            <ToolbarBtn icon={Download} label="Export" />
            <ToolbarBtn icon={MoreHorizontal} />
          </div>
        </div>

        {/* Money summary strip */}
        <div className="mt-4 grid grid-cols-5 gap-px bg-border rounded-md overflow-hidden border">
          <Money label="Billed"    value={formatCents(claim.total_billed)} />
          <Money label="Allowed"   value={formatCents(result.run.line_results.reduce((s, lr) => s + lr.allowed, 0))} />
          <Money label="Plan Paid" value={formatCents(result.run.total_plan_paid)} tone="positive" arrow />
          <Money label="Member Resp" value={formatCents(result.run.total_member_responsibility)} tone="negative" />
          <Money label="Adjustments" value={formatCents(result.run.line_results.reduce((s, lr) => s + lr.adjustments.reduce((a, ad) => a + ad.amount, 0), 0))} tone="muted" />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0 mt-4 -mb-3 border-b border-transparent">
          {tabs.map(t => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                disabled={t.disabled}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-primary text-foreground'
                    : t.disabled
                      ? 'border-transparent text-muted-foreground/40 cursor-not-allowed'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === 'summary' && (
          <div className="space-y-4">
            <RunSummaryPanel claim={claim} run={result.run} trace={result.trace} />
            <AuditReadinessPanel claim={claim} run={result.run} trace={result.trace} />
            <NucleusVerificationPanel claim={claim} />
            <SummaryTab claim={claim} result={result} />
          </div>
        )}
        {tab === 'lines' && (
          <AdjudicationPanel claim={claim} run={result.run} onShowTrace={() => setTab('trace')} />
        )}
        {tab === 'cob' && (
          <AdjudicationPanel claim={claim} run={result.run} onShowTrace={() => setTab('trace')} />
        )}
        {tab === 'trace' && (
          <TraceViewer trace={result.trace} claim={claim} run={result.run} onClose={() => setTab('summary')} />
        )}
        {tab === 'state' && (
          <StateDiagram
            currentStatus={claim.status}
            claimId={claim.claim_id}
            hasPrimacyConfirmation={claim.ohi_indicators.length > 0}
            onClose={() => setTab('summary')}
          />
        )}
        {tab === 'case' && caseData && (
          <div className="space-y-4">
            <CaseLinkingPanel
              caseData={caseData}
              events={caseEvents}
              claims={claims}
              adjResults={adjResults}
              currentClaimId={claim.claim_id}
              onSelectClaim={onSelectClaim}
            />
            <CasePanel
              caseData={caseData}
              events={caseEvents}
              claims={claims}
              adjResults={adjResults}
              accumulators={accumulators}
              contract={contract}
              plan={plan}
              priorOutcomes={priorOutcomes}
              onSelectClaim={onSelectClaim}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">{label}</span>
      <span className={`text-foreground ${mono ? 'font-mono' : ''}`}>{value}</span>
    </span>
  );
}

function ToolbarBtn({ icon: Icon, label }: { icon: typeof FileText; label?: string }) {
  return (
    <button className="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md border bg-card hover:bg-muted text-[12px] text-foreground">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      {label && <span>{label}</span>}
    </button>
  );
}

function Money({ label, value, tone, arrow }: { label: string; value: string; tone?: 'positive' | 'negative' | 'muted'; arrow?: boolean }) {
  const cls =
    tone === 'positive' ? 'amount-positive'
    : tone === 'negative' ? 'amount-negative'
    : tone === 'muted' ? 'text-muted-foreground'
    : 'text-foreground';
  return (
    <div className="bg-card px-4 py-2.5 relative">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-[15px] font-semibold tabular-nums mt-0.5 ${cls}`}>{value}</div>
      {arrow && <ArrowRight className="absolute -left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground bg-card rounded-full" />}
    </div>
  );
}

function SummaryTab({ claim, result }: { claim: Claim; result: AdjResult }) {
  const totalAdjustments = result.run.line_results.reduce((s, lr) => s + lr.adjustments.reduce((a, ad) => a + ad.amount, 0), 0);
  const totalDed = result.run.line_results.reduce((s, lr) => s + lr.deductible_applied, 0);
  const totalCoins = result.run.line_results.reduce((s, lr) => s + lr.coinsurance, 0);
  const totalCopay = result.run.line_results.reduce((s, lr) => s + lr.copay, 0);

  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Member responsibility breakdown */}
      <section className="panel col-span-2">
        <div className="panel-header"><span className="panel-title">Member Cost-Share Composition</span></div>
        <div className="p-4">
          <BreakdownRow label="Deductible Applied"  value={totalDed} total={result.run.total_member_responsibility} tone="negative" />
          <BreakdownRow label="Coinsurance"         value={totalCoins} total={result.run.total_member_responsibility} tone="negative" />
          <BreakdownRow label="Copay"               value={totalCopay} total={result.run.total_member_responsibility} tone="negative" />
          <div className="mt-3 pt-3 border-t flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Total Member</span>
            <span className="font-mono text-[14px] font-semibold amount-negative tabular-nums">
              ${(result.run.total_member_responsibility / 100).toFixed(2)}
            </span>
          </div>
        </div>
      </section>

      {/* Provenance */}
      <section className="panel">
        <div className="panel-header"><span className="panel-title">Provenance</span></div>
        <div className="p-4 space-y-2 text-[12px]">
          <KV label="Trace ID"   value={result.trace.trace_id} mono />
          <KV label="Rule Set"   value={result.trace.rule_set_version} mono />
          <KV label="Plan"       value={result.trace.plan_version} mono />
          <KV label="Contract"   value={result.trace.contract_version} mono />
          <KV label="Calc Policy" value={result.trace.calc_policy_version} mono />
          <KV label="Input Hash" value={result.trace.inputs_snapshot_hash.slice(0, 24) + '…'} mono />
        </div>
      </section>

      {/* OHI indicators */}
      {claim.ohi_indicators.length > 0 && (
        <section className="panel col-span-3">
          <div className="panel-header">
            <span className="panel-title">Other Health Insurance · Coordination of Benefits</span>
            <span className="status-cob">{claim.ohi_indicators.length} payer{claim.ohi_indicators.length > 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y">
            {claim.ohi_indicators.map((ohi, i) => (
              <div key={i} className="grid grid-cols-5 gap-4 px-4 py-2.5 text-[12px]">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Payer</div>
                  <div className="font-medium text-foreground">{ohi.payer_name}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Payer ID</div>
                  <div className="font-mono text-foreground">{ohi.payer_id}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Coverage</div>
                  <div className="text-foreground capitalize">{ohi.coverage_type}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Primacy</div>
                  <div className="font-mono text-foreground">{ohi.primacy_order ?? '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Subscriber</div>
                  <div className="font-mono text-foreground">{ohi.subscriber_id ?? '—'}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Adjustments quick view */}
      <section className="panel col-span-3">
        <div className="panel-header">
          <span className="panel-title">Adjustments</span>
          <span className="text-[11px] font-mono text-muted-foreground">Total {`$${(totalAdjustments / 100).toFixed(2)}`}</span>
        </div>
        <div className="divide-y">
          <div className="grid grid-cols-5 gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30">
            <span>Line</span><span>Code</span><span>Group</span><span>Category</span><span className="text-right">Amount</span>
          </div>
          {result.run.line_results.flatMap(lr =>
            lr.adjustments.map((adj, i) => (
              <div key={`${lr.line_id}-${i}`} className="grid grid-cols-5 gap-2 px-4 py-2 text-[12px]">
                <span className="font-mono text-muted-foreground">{lr.line_id}</span>
                <span className="font-mono font-medium text-foreground">{adj.reason_code}</span>
                <span className="text-muted-foreground">CO</span>
                <span className="text-muted-foreground capitalize">{adj.category}</span>
                <span className="font-mono text-right amount-negative tabular-nums">${(adj.amount / 100).toFixed(2)}</span>
              </div>
            ))
          )}
          {result.run.line_results.every(lr => lr.adjustments.length === 0) && (
            <div className="px-4 py-3 text-[12px] text-muted-foreground italic">No adjustments on this claim.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function BreakdownRow({ label, value, total, tone }: { label: string; value: number; total: number; tone: 'negative' | 'positive' }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const cls = tone === 'positive' ? 'amount-positive' : 'amount-negative';
  const bar = tone === 'positive' ? 'bg-status-paid' : 'bg-status-denied';
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-mono font-medium tabular-nums ${cls}`}>${(value / 100).toFixed(2)}</span>
      </div>
      <div className="h-1 mt-1 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${bar} opacity-60`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">{label}</span>
      <span className={`text-foreground truncate ${mono ? 'font-mono text-[11.5px]' : ''}`} title={value}>{value}</span>
    </div>
  );
}
