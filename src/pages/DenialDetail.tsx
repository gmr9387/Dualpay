import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useClarityData, formatCents, relativeTime, slaStatus } from '@/hooks/use-clarity-data';
import { PageHeader, Panel, SeverityBadge, StateBadge, OwnerChip, RecoverabilityBar, AgingChip, QueueChip, EmptyState, ScrollBody } from '@/components/clarity/primitives';
import { CATEGORY_LABEL } from '@/engine/denial-intelligence';
import { explainRecoverability } from '@/engine/recoverability';
import { nextBestAction, URGENCY_CLS, URGENCY_LABEL } from '@/engine/next-action';
import { ArrowLeft, AlertOctagon, FileText, CheckCircle2, Send, Loader2, Clock, TrendingUp, TrendingDown as TrendDownIcon, Sparkles, Zap, ClipboardList } from 'lucide-react';

export default function DenialDetail() {
  const { claimId } = useParams();
  const { data: claims, isLoading } = useClarityData();
  const claim = useMemo(() => claims?.find(c => c.claim_id === claimId), [claims, claimId]);

  if (isLoading) return <div className="h-full flex items-center justify-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…</div>;
  if (!claim) return <EmptyState title="Claim not found" body="The claim ID does not exist in the operational dataset." icon={<AlertOctagon className="h-5 w-5" />} />;

  const sla = slaStatus(claim.intel.sla_due_at);
  const slaToneCls = sla.tone === 'breach' ? 'text-status-denied' : sla.tone === 'warn' ? 'text-status-pending' : 'text-status-paid';

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`${claim.claim_id} · Denial Drilldown`}
        subtitle={`${claim.intel.payer_name} → ${claim.provider_name} (${claim.facility_name}) · ${claim.lines.length} service line${claim.lines.length !== 1 ? 's' : ''}`}
        actions={
          <Link to="/denials" className="h-8 px-3 inline-flex items-center gap-1.5 text-[12px] rounded-md border bg-card hover:bg-muted text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Denials
          </Link>
        }
      />

      <div className="px-5 py-3 border-b bg-card flex items-center gap-3 flex-wrap">
        <StateBadge state={claim.intel.reimbursement_state} />
        <SeverityBadge severity={claim.intel.severity} />
        <AgingChip bucket={claim.intel.aging_bucket} />
        <OwnerChip owner={claim.intel.workflow_owner} />
        {claim.intel.is_escalated && <span className="status-denied">Escalated</span>}
        <span className={`text-[11px] font-mono flex items-center gap-1 ${slaToneCls}`}>
          <Clock className="h-3 w-3" /> SLA · {sla.label}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {claim.intel.queues.map(q => <QueueChip key={q} queue={q} />)}
        </div>
      </div>

      <ScrollBody>
        <div className="grid grid-cols-3 gap-4 p-5">
          {/* Reimbursement summary */}
          <div className="col-span-2 space-y-4">
            <Panel title="Reimbursement Position">
              <div className="grid grid-cols-4 gap-4">
                <Money label="Billed"   value={formatCents(claim.total_billed)} />
                <Money label="Expected" value={formatCents(claim.intel.expected_reimbursement_cents)} />
                <Money label="Actual"   value={formatCents(claim.intel.actual_reimbursement_cents)} tone="positive" />
                <Money label="At Risk"  value={formatCents(claim.intel.amount_at_risk_cents)} tone="negative" />
              </div>
              <div className="mt-4 pt-3 border-t flex items-center gap-4 text-[11.5px] text-muted-foreground">
                <div className="flex-1">
                  <div className="text-[10px] uppercase tracking-wider mb-1">Recoverability</div>
                  <RecoverabilityBar score={claim.intel.recoverability_score} />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider">Underpayment</div>
                  <div className="font-mono text-[13px] text-foreground">{formatCents(claim.intel.underpayment_cents)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider">Aging</div>
                  <div className="font-mono text-[13px] text-foreground">{claim.intel.aging_days}d</div>
                </div>
              </div>
            </Panel>

            <RecoverabilityExplainer claim={claim} />

            <Panel title={`Denial Events (${claim.intel.denial_events.length})`}>
              {claim.intel.denial_events.length === 0 ? (
                <div className="text-[12px] text-muted-foreground italic">No denials recorded — claim cleanly adjudicated.</div>
              ) : (
                <div className="divide-y -mx-4 -my-4">
                  {claim.intel.denial_events.map(d => (
                    <div key={d.denial_id} className="px-4 py-3 space-y-2">
                      <div className="flex items-start gap-3">
                        <div className="font-mono text-[14px] font-semibold text-foreground shrink-0">
                          {d.carc_code}{d.rarc_code && <span className="text-muted-foreground">/{d.rarc_code}</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium text-foreground">{d.root_cause}</div>
                          {d.payer_message && (
                            <div className="text-[11.5px] text-muted-foreground italic mt-0.5">"{d.payer_message}"</div>
                          )}
                        </div>
                        <SeverityBadge severity={d.severity} />
                      </div>
                      <div className="grid grid-cols-[1fr_1fr_1fr_120px] gap-3 items-center pt-1">
                        <KV label="Category" value={CATEGORY_LABEL[d.category]} />
                        <KV label="Owner"    value={d.workflow_owner} />
                        <KV label="Group"    value={d.group_code} mono />
                        <div className="text-right">
                          <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">At Risk</div>
                          <div className="font-mono text-[12.5px] amount-negative tabular-nums">{formatCents(d.amount_cents)}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div>
                          <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-1">Recoverability</div>
                          <RecoverabilityBar score={d.recoverability_score} />
                        </div>
                        <div>
                          <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-1">Appeal Eligible</div>
                          <span className={d.appeal_eligible ? 'text-status-paid text-[12px] font-medium' : 'text-muted-foreground text-[12px]'}>
                            {d.appeal_eligible ? 'Yes' : 'No'}
                          </span>
                        </div>
                      </div>
                      <div className="rounded bg-accent/40 border border-primary/15 p-2.5 mt-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-1">Recommended Action</div>
                        <div className="text-[12px] text-foreground">{d.recommended_action}</div>
                      </div>
                      {d.evidence_required.length > 0 && (
                        <div className="text-[11.5px] text-muted-foreground">
                          <span className="font-semibold text-foreground">Evidence required: </span>
                          {d.evidence_required.join(' · ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Reimbursement Timeline">
              <ol className="relative space-y-3 pl-5 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-px before:bg-border">
                {claim.intel.timeline.map(e => (
                  <li key={e.event_id} className="relative">
                    <span className="absolute -left-[18px] top-1.5 h-3 w-3 rounded-full bg-card border-2 border-primary" />
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12.5px] text-foreground">{e.description}</div>
                        <div className="text-[10.5px] text-muted-foreground font-mono">{e.actor} · {relativeTime(e.occurred_at)}</div>
                      </div>
                      {e.amount_cents !== undefined && (
                        <span className="font-mono text-[12px] text-foreground tabular-nums shrink-0">{formatCents(e.amount_cents)}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>

          {/* Right rail */}
          <div className="space-y-4">
            <NextActionPanel claim={claim} />
            <Panel title="Quick Actions">
              <div className="space-y-1.5">
                <Link to={`/packet/${claim.claim_id}`} className="w-full h-8 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                  <Send className="h-3.5 w-3.5" /> Build Appeal Packet
                </Link>
                <Link to={`/recover?claim=${encodeURIComponent(claim.claim_id)}`} className="w-full h-8 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-2 border bg-card text-foreground hover:bg-muted">
                  <ClipboardList className="h-3.5 w-3.5" /> Track Recovery Case
                </Link>
                <ActionBtn icon={<FileText className="h-3.5 w-3.5" />} label="Attach Evidence" />
                <ActionBtn icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Mark Resolved" />
                <ActionBtn icon={<AlertOctagon className="h-3.5 w-3.5" />} label="Escalate" tone="danger" />
              </div>
            </Panel>

            {claim.intel.evidence_missing.length > 0 && (
              <Panel title="Missing Evidence">
                <ul className="space-y-1.5 text-[12px]">
                  {claim.intel.evidence_missing.map(e => (
                    <li key={e} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-status-denied shrink-0" />
                      <span className="text-foreground">{e}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <Panel title="Payer Responses">
              <div className="space-y-2 text-[12px]">
                {claim.intel.payer_responses.map(r => (
                  <div key={r.response_id} className="rounded border bg-muted/30 p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-[11px] font-semibold text-foreground">{r.response_type}</span>
                      <span className="text-[10.5px] text-muted-foreground font-mono">{relativeTime(r.received_at)}</span>
                    </div>
                    <div className="text-[11.5px] text-muted-foreground">{r.payer_name} · {r.source}</div>
                    <div className="grid grid-cols-2 gap-2 mt-1.5 text-[11px] font-mono tabular-nums">
                      <span>Allowed <b className="text-foreground">{formatCents(r.allowed_cents)}</b></span>
                      <span>Paid <b className="text-foreground">{formatCents(r.paid_cents)}</b></span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            {claim.intel.appeals.length > 0 && (
              <Panel title={`Appeals (${claim.intel.appeals.length})`}>
                <div className="space-y-2 text-[12px]">
                  {claim.intel.appeals.map(a => (
                    <div key={a.appeal_id} className="rounded border bg-muted/30 p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-[11px] font-semibold text-foreground">Level {a.level} · {a.status}</span>
                        <span className="text-[10.5px] text-muted-foreground font-mono">{a.filed_at ? relativeTime(a.filed_at) : 'unfiled'}</span>
                      </div>
                      <div className="text-[11.5px] text-foreground">{a.rationale}</div>
                      <div className="mt-1.5 text-[11px] font-mono">Disputed <b>{formatCents(a.amount_in_dispute_cents)}</b></div>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function Money({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  const cls = tone === 'positive' ? 'amount-positive' : tone === 'negative' ? 'amount-negative' : 'text-foreground';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-[16px] font-semibold tabular-nums mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}
function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-[12px] text-foreground ${mono ? 'font-mono' : ''} capitalize`}>{value}</div>
    </div>
  );
}
function ActionBtn({ icon, label, tone }: { icon: React.ReactNode; label: string; tone?: 'primary' | 'danger' }) {
  const cls =
    tone === 'primary' ? 'bg-primary text-primary-foreground hover:bg-primary/90'
    : tone === 'danger' ? 'border bg-card text-status-denied hover:bg-status-denied/5'
    : 'border bg-card text-foreground hover:bg-muted';
  return (
    <button className={`w-full h-8 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-2 transition-colors ${cls}`}>
      {icon} {label}
    </button>
  );
}

function RecoverabilityExplainer({ claim }: { claim: Parameters<typeof explainRecoverability>[0] }) {
  const exp = explainRecoverability(claim);
  const tierCls =
    exp.tier === 'HIGH'   ? 'bg-status-paid/10 text-status-paid border-status-paid/30'
    : exp.tier === 'MEDIUM' ? 'bg-status-pending/10 text-status-pending border-status-pending/30'
    : 'bg-status-denied/10 text-status-denied border-status-denied/30';
  return (
    <Panel
      title="Recoverability Engine"
      action={
        <div className="flex items-center gap-2">
          <Link to={`/transparency/${claim.claim_id}`} className="text-[10.5px] font-mono uppercase tracking-wider text-primary hover:underline">
            Why this score →
          </Link>
          <span className={`pill border ${tierCls}`}>{exp.tier} · {exp.score}</span>
        </div>
      }
    >
      <div className="flex items-start gap-2.5 mb-3">
        <Sparkles className="h-4 w-4 text-primary mt-0.5" />
        <div className="text-[12.5px] text-foreground">{exp.headline}</div>
      </div>
      <div className="space-y-1.5">
        {exp.factors.map((f, i) => (
          <div key={i} className="grid grid-cols-[140px_1fr_70px] gap-3 items-center text-[12px] py-1 border-b last:border-b-0 border-border/60">
            <div>
              <div className="text-foreground font-medium">{f.label}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{f.weight}</div>
            </div>
            <div className="text-muted-foreground text-[11.5px]">{f.detail}</div>
            <div className={`text-right font-mono tabular-nums text-[12px] flex items-center justify-end gap-1 ${
              f.delta > 0 ? 'amount-positive' : f.delta < 0 ? 'amount-negative' : 'text-muted-foreground'
            }`}>
              {f.delta > 0 ? <TrendingUp className="h-3 w-3" /> : f.delta < 0 ? <TrendDownIcon className="h-3 w-3" /> : null}
              {f.delta > 0 ? `+${f.delta}` : f.delta}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded bg-accent/40 border border-primary/15 p-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-1">Recommended Recovery Path</div>
        <div className="text-[12px] text-foreground">{exp.recommended_path}</div>
      </div>
    </Panel>
  );
}

function NextActionPanel({ claim }: { claim: Parameters<typeof nextBestAction>[0] }) {
  const a = nextBestAction(claim);
  return (
    <Panel
      title="Next Best Action"
      action={<span className={`pill border ${URGENCY_CLS[a.urgency]}`}>{URGENCY_LABEL[a.urgency]}</span>}
    >
      <div className="flex items-start gap-2 mb-2">
        <Zap className="h-4 w-4 text-primary mt-0.5" />
        <div>
          <div className="text-[13px] font-semibold text-foreground">{a.headline}</div>
          <div className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground mt-0.5">{a.owner} · {a.effort_minutes}m</div>
        </div>
      </div>
      <ul className="space-y-1 text-[11.5px] mb-2">
        {a.why.map((w, i) => (
          <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" /><span>{w}</span>
          </li>
        ))}
      </ul>
      <div className="pt-2 border-t flex items-center justify-between text-[11px] font-mono">
        <span className="text-muted-foreground">Expected · {Math.round(a.expected_probability * 100)}%</span>
        <span className="amount-positive">≈{formatCents(a.expected_value_cents)}</span>
      </div>
    </Panel>
  );
}


