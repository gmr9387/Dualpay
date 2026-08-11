/**
 * Appeal Packet Builder — assembles a complete appeal package for
 * a single claim with denial details, evidence, payer requirements,
 * and a submission checklist.  Returns explicit readiness verdict.
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useClarityData, formatCents } from '@/hooks/use-clarity-data';
import { useEvidenceDocuments } from '@/hooks/use-evidence-documents';
import { PageHeader, Panel, ScrollBody, EmptyState, SeverityBadge, RecoverabilityBar } from '@/components/clarity/primitives';
import { recommendPlaybook } from '@/engine/playbooks';
import { findRequirementsFor } from '@/engine/payer-requirements';
import { nextBestAction, URGENCY_CLS, URGENCY_LABEL } from '@/engine/next-action';
import { CATEGORY_LABEL } from '@/engine/denial-intelligence';
import { logAppealEvent, makeIdempotencyKey } from '@/data/operational-workflows';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/hooks/use-org';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { buildAppealPacketPdf } from '@/lib/pdf-appeal';
import { generateAppealPacket } from '@/engine/appeal-packet-generator';
import { uploadAppealPacket } from '@/lib/evidence-documents';
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, XCircle, FileText, Send, Inbox, Download, Info } from 'lucide-react';

export default function AppealPacket() {
  const { claimId } = useParams();
  const { data: claims, isLoading } = useClarityData();
  const { currentOrg } = useOrg();
  const { user } = useAuth();
  const { data: documents = [] } = useEvidenceDocuments({ claim_id: claimId });
  const claim = useMemo(() => claims?.find(c => c.claim_id === claimId), [claims, claimId]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (isLoading) return <div className="h-full flex items-center justify-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…</div>;

  if (!claimId) return <PacketPicker claims={claims ?? []} />;
  if (!claim) return <EmptyState title="Claim not found" body="Pick a claim from the picker." icon={<AlertCircle className="h-5 w-5" />} />;

  const primary = claim.intel.denial_events[0];
  const rec = recommendPlaybook(claim, primary);
  const reqs = claims ? findRequirementsFor(claim.intel.payer_id, claims) : undefined;
  const action = nextBestAction(claim, primary);

  // Compose checklist
  const checklist: Array<{ label: string; ok: boolean; detail?: string }> = [
    { label: 'Denial details captured', ok: !!primary, detail: primary ? `${primary.carc_code}${primary.rarc_code ? '/' + primary.rarc_code : ''} · ${CATEGORY_LABEL[primary.category]}` : 'No denial on record' },
    { label: 'Claim summary attached', ok: true, detail: `${claim.lines.length} line(s) · ${formatCents(claim.total_billed)} billed` },
    { label: 'Reimbursement timeline complete', ok: claim.intel.timeline.length > 0, detail: `${claim.intel.timeline.length} events` },
    { label: 'Required evidence present', ok: claim.intel.evidence_missing.length === 0, detail: claim.intel.evidence_missing.length === 0 ? 'All on file' : `${claim.intel.evidence_missing.length} item(s) missing` },
    { label: 'Payer requirements surfaced', ok: !!reqs, detail: reqs ? `${reqs.payer_name} · L1 ${reqs.appeal_deadlines.level_1_days}d` : 'No payer profile' },
    { label: 'Appeal rationale drafted', ok: !!rec, detail: rec ? rec.playbook.appeal_strategy.slice(0, 60) + '…' : 'No playbook matched' },
    { label: 'Within timely filing window', ok: !reqs || claim.intel.aging_days <= reqs.timely_filing_days, detail: reqs ? `${claim.intel.aging_days}d / ${reqs.timely_filing_days}d window` : '—' },
  ];
  const passing = checklist.filter(c => c.ok).length;
  const verdict = passing === checklist.length ? 'COMPLETE' : passing >= checklist.length - 2 ? 'MISSING_REQUIREMENTS' : 'INCOMPLETE';
  const verdictCls = verdict === 'COMPLETE' ? 'bg-status-paid/15 text-status-paid border-status-paid/30'
    : verdict === 'MISSING_REQUIREMENTS' ? 'bg-status-pending/15 text-status-pending border-status-pending/30'
    : 'bg-status-denied/15 text-status-denied border-status-denied/30';

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`Appeal Packet · ${claim.claim_id}`}
        subtitle={`${claim.intel.payer_name} · ${claim.provider_name}`}
        actions={
          <div className="flex items-center gap-2">
            <Link to="/packet" className="h-8 px-3 inline-flex items-center gap-1.5 text-[12px] rounded-md border bg-card hover:bg-muted text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> All Packets
            </Link>
            <Link to={`/denials/${claim.claim_id}`} className="h-8 px-3 inline-flex items-center gap-1.5 text-[12px] rounded-md border bg-card hover:bg-muted text-foreground">
              Open claim
            </Link>
          </div>
        }
      />

      <div className="px-5 py-3 border-b bg-card flex items-center gap-3">
        <span className={`pill border text-[11px] ${verdictCls}`}>
          {verdict === 'COMPLETE' ? <CheckCircle2 className="h-3 w-3 mr-1" />
           : verdict === 'INCOMPLETE' ? <XCircle className="h-3 w-3 mr-1" />
           : <AlertCircle className="h-3 w-3 mr-1" />}
          Appeal Readiness: {verdict.replace(/_/g, ' ')}
        </span>
        <span className="text-[12px] text-muted-foreground font-mono">{passing}/{checklist.length} requirements met</span>
        <div className="ml-auto flex items-center gap-2">
          {primary && <SeverityBadge severity={primary.severity} />}
          {primary && <div className="w-32"><RecoverabilityBar score={primary.recoverability_score} /></div>}
          <button
            onClick={async () => {
              try {
                const doc = buildAppealPacketPdf({
                  claim, checklist, verdict,
                  strategy: rec?.playbook.appeal_strategy,
                  payerRequirements: reqs ? {
                    payer_name: reqs.payer_name,
                    timely_filing_days: reqs.timely_filing_days,
                    appeal_deadlines: reqs.appeal_deadlines,
                  } : undefined,
                  orgName: currentOrg?.name,
                });
                const filename = `appeal-${claim.claim_id}-${new Date().toISOString().slice(0, 10)}.pdf`;
                doc.save(filename);
                if (currentOrg && claims) {
                  const packet = generateAppealPacket(claim, claims, documents);
                  await uploadAppealPacket({
                    org_id: currentOrg.org_id,
                    claim_id: claim.claim_id,
                    filename,
                    content: doc.output('blob'),
                    contentType: 'application/pdf',
                  });
                  await uploadAppealPacket({
                    org_id: currentOrg.org_id,
                    claim_id: claim.claim_id,
                    filename: filename.replace(/\.pdf$/, '.md'),
                    content: new Blob([packet.markdown], { type: 'text/markdown' }),
                  });
                }
                if (currentOrg) {
                  void appendOpsEvent({
                    kind: 'appeal_packet_generated',
                    claim_id: claim.claim_id,
                    summary: `Packet ${filename} generated for ${claim.intel.payer_name}`,
                    payload: { filename, org_id: currentOrg.org_id },
                  });
                }
                toast({ title: 'Packet downloaded', description: filename });
              } catch (err) {
                toast({ title: 'PDF generation failed', description: String(err), variant: 'destructive' });
              }
            }}
            className="h-8 px-3 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 border bg-card hover:bg-muted text-foreground"
          >
            <Download className="h-3.5 w-3.5" /> Download PDF
          </button>
          <button
            disabled={verdict !== 'COMPLETE' || submitting || submitted || !currentOrg}
            onClick={async () => {
              if (!currentOrg) { toast({ title: 'Select an organization first', variant: 'destructive' }); return; }
              setSubmitting(true);
              try {
                const dispute = primary?.amount_cents ?? claim.intel.amount_at_risk_cents;
                const payerName = claim.intel.payer_name;
                await logAppealEvent(claim.claim_id, currentOrg.org_id, {
                  kind: 'appeal_submitted',
                  summary: `Appeal marked submitted to ${payerName} · ${formatCents(dispute)} in dispute (delivery is manual)`,
                  appealStatus: 'pending_response',
                  notes: rec?.playbook.appeal_strategy,
                  idempotencyKey: makeIdempotencyKey('appeal'),
                });
                // Transition claim status so Executive ROI dashboards
                // can count this claim as an active appeal.
                const { error: statusErr } = await supabase
                  .from('claims')
                  .update({ status: 'appeal_pending', updated_at: new Date().toISOString() })
                  .eq('claim_id', claim.claim_id)
                  .eq('org_id', currentOrg.org_id);
                if (statusErr) console.warn('[appeal] status transition failed', statusErr.message);
                setSubmitted(true);
                toast({ title: 'Marked submitted', description: `${claim.claim_id} → ${payerName} · deliver packet via payer portal/fax/mail` });
              } catch (err) {
                toast({ title: 'Update failed', description: String(err), variant: 'destructive' });
              } finally {
                setSubmitting(false);
              }
            }}
            className="h-8 px-3 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {submitted ? 'Marked Submitted' : submitting ? 'Recording…' : 'Mark Submitted'}
          </button>
        </div>
      </div>

      <div className="px-5 py-2 border-b bg-muted/40 flex items-start gap-2 text-[11.5px] text-muted-foreground">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
        <span>
          <b className="text-foreground">Delivery is manual.</b> DualPay generates the packet and records the submission for audit — it does NOT transmit the appeal.
          Download the PDF and submit via the payer&apos;s portal, fax, or mail per their requirements.
        </span>
      </div>

      <ScrollBody>
        <div className="grid grid-cols-3 gap-4 p-5">
          <div className="col-span-2 space-y-4">
            <Panel title="Submission Checklist">
              <ul className="divide-y -mx-4 -my-4">
                {checklist.map((c, i) => (
                  <li key={i} className="px-4 py-2.5 flex items-start gap-3">
                    {c.ok ? <CheckCircle2 className="h-4 w-4 text-status-paid mt-0.5" />
                          : <XCircle className="h-4 w-4 text-status-denied mt-0.5" />}
                    <div className="flex-1">
                      <div className="text-[12.5px] text-foreground font-medium">{c.label}</div>
                      {c.detail && <div className="text-[11px] text-muted-foreground">{c.detail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>

            {primary && (
              <Panel title="Denial Details">
                <div className="grid grid-cols-2 gap-3 text-[12px]">
                  <Field label="CARC / RARC" value={`${primary.carc_code}${primary.rarc_code ? ' / ' + primary.rarc_code : ''}`} mono />
                  <Field label="Category" value={CATEGORY_LABEL[primary.category]} />
                  <Field label="Group code" value={primary.group_code} mono />
                  <Field label="Amount at risk" value={formatCents(primary.amount_cents)} mono />
                </div>
                <div className="mt-3 rounded bg-muted/40 p-2.5 text-[12px] text-foreground"><span className="font-semibold">Root cause: </span>{primary.root_cause}</div>
                {primary.payer_message && <div className="mt-2 text-[11.5px] italic text-muted-foreground">"{primary.payer_message}"</div>}
              </Panel>
            )}

            <Panel title="Claim Summary">
              <div className="grid grid-cols-4 gap-3 text-[12px]">
                <Field label="Member" value={claim.member_id} mono />
                <Field label="Provider NPI" value={claim.provider_npi} mono />
                <Field label="DOS" value={`${claim.service_date_from.slice(0,10)} → ${claim.service_date_to.slice(0,10)}`} mono />
                <Field label="Type" value={claim.claim_type} />
              </div>
              <div className="mt-3 border rounded">
                <div className="grid grid-cols-[80px_100px_1fr_80px_120px] gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b">
                  <span>Line</span><span>CPT</span><span>Diagnoses</span><span>Units</span><span className="text-right">Billed</span>
                </div>
                {claim.lines.map(l => (
                  <div key={l.line_id} className="grid grid-cols-[80px_100px_1fr_80px_120px] gap-2 px-3 py-1.5 text-[11.5px] border-b last:border-b-0">
                    <span className="font-mono">{l.claim_line_number}</span>
                    <span className="font-mono">{l.procedure_code}{l.procedure_modifier && '-' + l.procedure_modifier}</span>
                    <span className="font-mono text-muted-foreground truncate">{l.diagnosis_codes.join(', ')}</span>
                    <span className="font-mono">{l.units}</span>
                    <span className="font-mono text-right tabular-nums">{formatCents(l.billed_amount)}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Appeal Notes & Rationale">
              {rec ? (
                <div className="text-[12.5px] text-foreground space-y-2">
                  <p>{rec.playbook.appeal_strategy}</p>
                  <div className="rounded bg-accent/40 border border-primary/15 p-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-1">Expected recovery</div>
                    <div className="text-[13px] font-mono">{Math.round(rec.expected_recovery_probability * 100)}% probability · ≈{formatCents(Math.round(claim.intel.amount_at_risk_cents * rec.expected_recovery_probability))}</div>
                  </div>
                </div>
              ) : (
                <div className="text-[12px] text-muted-foreground italic">No playbook matched this denial.</div>
              )}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Next Best Action" action={<span className={`pill border ${URGENCY_CLS[action.urgency]}`}>{URGENCY_LABEL[action.urgency]}</span>}>
              <div className="text-[13px] font-semibold text-foreground">{action.headline}</div>
              <div className="text-[11px] font-mono text-muted-foreground mt-0.5 uppercase tracking-wider">{action.owner}</div>
              <ul className="mt-2 space-y-1 text-[11.5px]">
                {action.why.map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" /><span>{w}</span></li>
                ))}
              </ul>
              <div className="mt-2 pt-2 border-t flex justify-between text-[11px] font-mono">
                <span className="text-muted-foreground">Expected value</span>
                <span className="amount-positive">≈{formatCents(action.expected_value_cents)}</span>
              </div>
            </Panel>

            <Panel title="Required Evidence">
              <ul className="text-[12px] space-y-1.5">
                {(rec?.playbook.required_evidence ?? primary?.evidence_required ?? []).map(e => {
                  const missing = claim.intel.evidence_missing.some(m => m.toLowerCase().includes(e.toLowerCase().split(' ')[0]));
                  return (
                    <li key={e} className="flex items-center gap-2">
                      {missing ? <XCircle className="h-3.5 w-3.5 text-status-denied" /> : <CheckCircle2 className="h-3.5 w-3.5 text-status-paid" />}
                      <span className={missing ? 'text-status-denied' : 'text-foreground'}>{e}</span>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            {reqs && (
              <Panel title={`Payer Requirements · ${reqs.payer_name}`}>
                <div className="space-y-1.5 text-[11.5px]">
                  <Row label="Timely filing" value={`${reqs.timely_filing_days}d`} />
                  <Row label="Level 1 window" value={`${reqs.appeal_deadlines.level_1_days}d`} />
                  <Row label="Level 2 window" value={`${reqs.appeal_deadlines.level_2_days}d`} />
                  <Row label="Overturn rate" value={`${Math.round(reqs.overturn_rate * 100)}%`} />
                  <Row label="Preferred channel" value={reqs.submission_channels.find(c => c.preferred)?.channel ?? 'portal'} />
                </div>
                {reqs.notes.length > 0 && (
                  <div className="mt-2 pt-2 border-t text-[11px] text-muted-foreground space-y-1">
                    {reqs.notes.map((n, i) => <div key={i} className="flex items-start gap-1"><FileText className="h-3 w-3 mt-0.5" /><span>{n}</span></div>)}
                  </div>
                )}
              </Panel>
            )}
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function PacketPicker({ claims }: { claims: Array<{ claim_id: string; intel: { payer_name: string; amount_at_risk_cents: number; denial_events: { length: number }[] | { length: number } } }> }) {
  // Pull claims with at least one denial event
  const list = useMemo(() => claims.filter(c => c.intel.denial_events.length > 0)
    .sort((a, b) => b.intel.amount_at_risk_cents - a.intel.amount_at_risk_cents).slice(0, 30), [claims]);
  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Appeal Packet Builder" subtitle="Select a denied claim to assemble its appeal packet." />
      <ScrollBody>
        <div className="p-5">
          {list.length === 0 ? (
            <EmptyState title="No claims to package" body="No active denials to build packets for." icon={<Inbox className="h-5 w-5" />} />
          ) : (
            <Panel title={`Build-ready claims (${list.length})`} dense>
              <div className="divide-y">
                <div className="grid grid-cols-[110px_1fr_140px_60px] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <span>Claim</span><span>Payer</span><span className="text-right">At Risk</span><span></span>
                </div>
                {list.map((c) => (
                  <Link key={c.claim_id} to={`/packet/${c.claim_id}`} className="grid grid-cols-[110px_1fr_140px_60px] gap-3 items-center px-4 py-2.5 hover:bg-muted/40 text-[12.5px]">
                    <span className="font-mono font-semibold text-foreground">{c.claim_id}</span>
                    <span className="text-foreground truncate">{c.intel.payer_name}</span>
                    <span className="font-mono text-right tabular-nums amount-negative">{formatCents(c.intel.amount_at_risk_cents)}</span>
                    <span className="text-[11px] text-primary justify-self-end">Build →</span>
                  </Link>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </ScrollBody>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-[12.5px] text-foreground ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}
