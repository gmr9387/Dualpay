import { useMemo, useState } from 'react';
import type { Case, CaseEvent, CaseStatus, AdjudicationDiff } from '@/types/case';
import type { AdjudicationRun, Claim } from '@/types/claim';
import type { TraceObject } from '@/types/trace';
import {
  calculateCaseAccumulatorImpact,
  retroRecalculate,
  type RetroResult,
} from '@/engine/case-management';
import { CASE_STATUS_TRANSITIONS, updateCaseStatus, addCaseNote } from '@/lib/case-actions';
import { useOrg } from '@/hooks/use-org';
import { can } from '@/lib/role-permissions';
import type { MemberAccumulators, ContractTerms, PlanBenefits, PriorPayerOutcome } from '@/types/claim';
import { Briefcase, Clock, ArrowRightLeft, AlertTriangle, ChevronDown, ChevronRight, RotateCcw, GitCompareArrows, StickyNote, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AdjResult {
  claimId: string;
  run: AdjudicationRun;
  trace: TraceObject;
}

interface CasePanelProps {
  caseData: Case;
  events: CaseEvent[];
  claims: Claim[];
  adjResults: AdjResult[];
  accumulators: Record<string, MemberAccumulators>;
  contract: ContractTerms;
  plan: PlanBenefits;
  priorOutcomes: PriorPayerOutcome[];
  onSelectClaim: (id: string) => void;
  onCaseEvent: (event: CaseEvent, newStatus?: CaseStatus) => void;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDelta(cents: number): string {
  const sign = cents > 0 ? '+' : '';
  return `${sign}${formatCents(cents)}`;
}

const EVENT_ICONS: Record<string, typeof Clock> = {
  CASE_CREATED: Briefcase,
  CLAIM_LINKED: ArrowRightLeft,
  CLAIM_REVERSED: AlertTriangle,
  CLAIM_ADJUSTED: GitCompareArrows,
  RETRO_TRIGGERED: RotateCcw,
  RETRO_COMPLETED: GitCompareArrows,
  ACCUMULATOR_UPDATED: ArrowRightLeft,
  STATUS_CHANGED: CheckCircle2,
  NOTE_ADDED: StickyNote,
};

export function CasePanel({
  caseData,
  events,
  claims,
  adjResults,
  accumulators,
  contract,
  plan,
  priorOutcomes,
  onSelectClaim,
  onCaseEvent,
}: CasePanelProps) {
  const { currentOrg } = useOrg();
  const canEdit = can.edit(currentOrg?.role);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showAccImpact, setShowAccImpact] = useState(true);
  const [retroResults, setRetroResults] = useState<RetroResult[] | null>(null);
  const [selectedRetro, setSelectedRetro] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);

  const nextStatuses = CASE_STATUS_TRANSITIONS[caseData.status];

  const handleStatusChange = async (newStatus: CaseStatus) => {
    setStatusBusy(true);
    const evt = await updateCaseStatus(caseData.case_id, newStatus);
    if (evt) onCaseEvent(evt, newStatus);
    setStatusBusy(false);
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setNoteBusy(true);
    const evt = await addCaseNote(caseData.case_id, noteText.trim());
    if (evt) { onCaseEvent(evt); setNoteText(''); }
    setNoteBusy(false);
  };

  const runsMap = useMemo(() => {
    const m = new Map<string, AdjudicationRun>();
    for (const r of adjResults) m.set(r.claimId, r.run);
    return m;
  }, [adjResults]);

  const accImpact = useMemo(
    () => calculateCaseAccumulatorImpact(caseData, claims, runsMap),
    [caseData, claims, runsMap]
  );

  const handleRetroRecalc = async (reversedClaimId: string) => {
    const caseClaims = claims.filter(c => caseData.claim_ids.includes(c.claim_id));
    const baseAcc = accumulators[caseData.member_id];
    if (!baseAcc) return;

    const results = await retroRecalculate(
      reversedClaimId, caseClaims, runsMap, baseAcc, contract, plan, priorOutcomes
    );
    setRetroResults(results);
  };

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      {/* Case Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{caseData.case_id}</h3>
            <p className="text-[10px] text-muted-foreground">
              {caseData.claim_ids.length} linked claims · Member {caseData.member_id}
            </p>
          </div>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
          caseData.status === 'RESOLVED' || caseData.status === 'CLOSED'
            ? 'status-paid'
            : caseData.status === 'PENDING_RETRO'
            ? 'status-pending'
            : 'status-cob'
        }`}>
          {caseData.status}
        </span>
      </div>

      {/* Case Actions */}
      {canEdit && (
        <div className="px-4 py-3 border-b space-y-2.5">
          {nextStatuses.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">Move to</span>
              {nextStatuses.map(status => (
                <Button
                  key={status}
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  disabled={statusBusy}
                  onClick={() => handleStatusChange(status)}
                >
                  {status.replace(/_/g, ' ')}
                </Button>
              ))}
            </div>
          )}
          <div className="flex items-start gap-2">
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Add a note to this case…"
              rows={2}
              className="flex-1 text-xs p-2 rounded border bg-background resize-none"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-[10px] shrink-0"
              disabled={noteBusy || !noteText.trim()}
              onClick={handleAddNote}
            >
              <StickyNote className="h-3 w-3 mr-1" />
              Add Note
            </Button>
          </div>
        </div>
      )}

      {/* Linked Claims */}
      <div className="px-4 py-3 border-b">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Linked Claims</div>
        <div className="space-y-1">
          {caseData.claim_ids.map(claimId => {
            const claim = claims.find(c => c.claim_id === claimId);
            const adj = adjResults.find(r => r.claimId === claimId);
            if (!claim) return null;
            return (
              <button
                key={claimId}
                onClick={() => onSelectClaim(claimId)}
                className="w-full flex items-center justify-between rounded px-3 py-2 text-xs border border-border/50 hover:border-primary/40 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium text-foreground">{claimId}</span>
                  <span className={
                    claim.status === 'PAID' || claim.status === 'ADJUDICATED' ? 'status-paid'
                    : claim.status === 'DENIED' ? 'status-denied'
                    : claim.status === 'REVERSED' ? 'status-adjusted'
                    : 'status-pending'
                  }>
                    {claim.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {adj && (
                    <>
                      <span className="font-mono amount-positive">{formatCents(adj.run.total_plan_paid)}</span>
                      <span className="font-mono amount-negative">{formatCents(adj.run.total_member_responsibility)}</span>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRetroRecalc(claimId);
                    }}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Retro
                  </Button>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Accumulator Impact */}
      <div className="border-b">
        <button
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/20 transition-colors"
          onClick={() => setShowAccImpact(!showAccImpact)}
        >
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Cross-Claim Accumulator Impact</span>
          {showAccImpact ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
        {showAccImpact && (
          <div className="px-4 pb-3 space-y-2">
            {/* Summary */}
            <div className="flex items-center gap-4 text-xs">
              <div className="rounded px-3 py-2 bg-muted/30 border border-border/50 flex-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Deductible</div>
                <div className="font-mono font-semibold amount-negative">{formatCents(accImpact.total_deductible_applied)}</div>
              </div>
              <div className="rounded px-3 py-2 bg-muted/30 border border-border/50 flex-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total OOP</div>
                <div className="font-mono font-semibold amount-negative">{formatCents(accImpact.total_oop_applied)}</div>
              </div>
              <div className="rounded px-3 py-2 bg-muted/30 border border-border/50 flex-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Plan Paid</div>
                <div className="font-mono font-semibold amount-positive">{formatCents(accImpact.total_plan_paid)}</div>
              </div>
            </div>
            {/* Per-claim breakdown */}
            <div className="text-[10px] text-muted-foreground">
              <div className="grid grid-cols-6 gap-2 font-semibold uppercase tracking-wider py-1 px-1">
                <span>Claim</span>
                <span className="text-right">Deductible</span>
                <span className="text-right">Coinsurance</span>
                <span className="text-right">Copay</span>
                <span className="text-right">Plan Paid</span>
                <span className="text-right">Member Resp</span>
              </div>
              {accImpact.claims.map(c => (
                <div key={c.claim_id} className="grid grid-cols-6 gap-2 py-1 px-1 border-t border-border/30 text-xs">
                  <span className="font-mono text-foreground">{c.claim_id.slice(-5)}</span>
                  <span className="font-mono text-right amount-negative">{c.deductible_applied > 0 ? formatCents(c.deductible_applied) : '—'}</span>
                  <span className="font-mono text-right amount-negative">{c.coinsurance_applied > 0 ? formatCents(c.coinsurance_applied) : '—'}</span>
                  <span className="font-mono text-right amount-negative">{c.copay_applied > 0 ? formatCents(c.copay_applied) : '—'}</span>
                  <span className="font-mono text-right amount-positive">{formatCents(c.plan_paid)}</span>
                  <span className="font-mono text-right amount-negative">{formatCents(c.member_responsibility)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Retro-Recalculation Results (Diff Viewer) */}
      {retroResults && retroResults.length > 0 && (
        <div className="border-b">
          <div className="px-4 py-2.5 bg-status-pending/5 border-b border-status-pending/20">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <GitCompareArrows className="h-3.5 w-3.5 text-status-pending" />
              Retro-Recalculation Results
              <span className="text-muted-foreground font-normal ml-1">
                ({retroResults.length} claim{retroResults.length !== 1 ? 's' : ''} affected)
              </span>
            </div>
          </div>
          <div className="px-4 py-3 space-y-2">
            {retroResults.map(rr => (
              <div key={rr.claimId} className="rounded border border-border/50">
                <button
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/20 transition-colors"
                  onClick={() => setSelectedRetro(selectedRetro === rr.claimId ? null : rr.claimId)}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono font-medium text-foreground">{rr.claimId}</span>
                    <span className={`font-mono font-semibold ${rr.diff.total_plan_paid_delta >= 0 ? 'amount-positive' : 'amount-negative'}`}>
                      Plan: {formatDelta(rr.diff.total_plan_paid_delta)}
                    </span>
                    <span className={`font-mono font-semibold ${rr.diff.total_member_resp_delta <= 0 ? 'amount-positive' : 'amount-negative'}`}>
                      Member: {formatDelta(rr.diff.total_member_resp_delta)}
                    </span>
                  </div>
                  {selectedRetro === rr.claimId ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
                {selectedRetro === rr.claimId && (
                  <DiffTable diff={rr.diff} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {retroResults && retroResults.length === 0 && (
        <div className="px-4 py-3 border-b text-xs text-muted-foreground italic">
          No subsequent claims affected by this reversal.
        </div>
      )}

      {/* Event Timeline */}
      <div>
        <button
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/20 transition-colors"
          onClick={() => setShowTimeline(!showTimeline)}
        >
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Case Timeline</span>
          {showTimeline ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
        {showTimeline && (
          <div className="px-4 pb-3">
            <div className="relative ml-3 border-l border-border/50">
              {events.map((evt, idx) => {
                const Icon = EVENT_ICONS[evt.event_type] ?? Clock;
                return (
                  <div key={evt.event_id} className="relative pl-6 pb-4 last:pb-0">
                    <div className="absolute -left-[7px] top-0.5 h-3.5 w-3.5 rounded-full bg-surface-2 border border-border flex items-center justify-center">
                      <Icon className="h-2 w-2 text-muted-foreground" />
                    </div>
                    <div className="text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{evt.event_type.replace(/_/g, ' ')}</span>
                        {evt.claim_id && (
                          <span className="font-mono text-primary text-[10px]">{evt.claim_id}</span>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-0.5">{evt.description}</p>
                      <span className="text-[10px] text-muted-foreground/60 font-mono">
                        {new Date(evt.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Diff Table Component ──────────────────────────────────────

function DiffTable({ diff }: { diff: AdjudicationDiff }) {
  if (diff.line_diffs.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground italic border-t border-border/30">
        No line-level changes detected.
      </div>
    );
  }

  return (
    <div className="border-t border-border/30">
      <div className="grid grid-cols-5 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-1.5 bg-muted/10">
        <span>Line</span>
        <span>Field</span>
        <span className="text-right">Before</span>
        <span className="text-right">After</span>
        <span className="text-right">Delta</span>
      </div>
      {diff.line_diffs.map((ld, i) => (
        <div key={i} className="grid grid-cols-5 gap-2 text-xs px-3 py-1.5 border-t border-border/20">
          <span className="font-mono text-muted-foreground">{ld.line_id}</span>
          <span className="text-muted-foreground capitalize">{ld.field.replace(/_/g, ' ')}</span>
          <span className="font-mono text-right text-muted-foreground">{formatCents(ld.before)}</span>
          <span className="font-mono text-right text-foreground">{formatCents(ld.after)}</span>
          <span className={`font-mono text-right font-semibold ${ld.delta >= 0 ? 'amount-positive' : 'amount-negative'}`}>
            {formatDelta(ld.delta)}
          </span>
        </div>
      ))}
    </div>
  );
}
