import { useState } from 'react';
import { useDisputes } from '@/hooks/use-contracts';
import { updateDisputeStatus, recordClientResponse, markReportGenerated, markReportSent } from '@/lib/contracts';
import { downloadRecoveryReportPdf } from '@/lib/pdf-recovery-report';
import { formatCents } from '@/hooks/use-clarity-data';
import { useOrg } from '@/hooks/use-org';
import { can } from '@/lib/role-permissions';
import { toast } from '@/hooks/use-toast';
import type { UnderpaymentDispute, ClientResponse } from '@/types/contracts';
import { FileDown, Send } from 'lucide-react';

const SEVERITY_TONE: Record<string, string> = {
  critical: 'bg-status-denied/15 text-status-denied border-status-denied/30',
  high:     'bg-status-pending/20 text-status-pending border-status-pending/30',
  medium:   'bg-status-pending/10 text-status-pending border-status-pending/20',
  low:      'bg-muted text-muted-foreground border-border',
};

const RESPONSE_LABEL: Record<string, string> = {
  pending: 'Pending',
  approved_pursue: 'Approved — Pursue',
  declined: 'Declined',
  handling_internally: 'Handling Internally',
};

export default function ContractDisputes() {
  const { disputes, loading, reload } = useDisputes();
  const { currentOrg, setRecoveryFeePercent } = useOrg();
  const canApprove = can.escalate(currentOrg?.role);
  const canManageOrg = can.manageOrg(currentOrg?.role);
  const [feeInput, setFeeInput] = useState<string | null>(null);
  const [savingFee, setSavingFee] = useState(false);

  const setStatus = async (id: string, status: string) => {
    await updateDisputeStatus(id, status, { feePercentBps: currentOrg?.recovery_fee_percent_bps });
    reload();
  };

  const respondAs = async (id: string, response: ClientResponse) => {
    if (response === 'pending') return;
    await recordClientResponse(id, response);
    reload();
  };

  const generateReport = async (d: UnderpaymentDispute) => {
    const filename = downloadRecoveryReportPdf({ dispute: d, orgName: currentOrg?.name });
    await markReportGenerated(d.dispute_id);
    reload();
    toast({ title: 'Recovery report downloaded', description: filename });
  };

  const markSent = async (d: UnderpaymentDispute) => {
    await markReportSent(d.dispute_id);
    reload();
    toast({ title: 'Marked sent', description: `${d.claim_id} · deliver the report to the client manually` });
  };

  const saveFee = async () => {
    if (feeInput === null) return;
    const pct = Number(feeInput);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast({ title: 'Invalid fee percent', description: 'Enter a value between 0 and 100', variant: 'destructive' });
      return;
    }
    setSavingFee(true);
    const ok = await setRecoveryFeePercent(Math.round(pct * 100));
    setSavingFee(false);
    if (ok) { toast({ title: 'Recovery fee updated', description: `${pct.toFixed(1)}%` }); setFeeInput(null); }
    else toast({ title: 'Update failed', variant: 'destructive' });
  };

  const currentFeePct = ((currentOrg?.recovery_fee_percent_bps ?? 0) / 100).toFixed(1);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Contract Recovery</h1>
          <p className="text-[12.5px] text-muted-foreground">
            Claim → remittance → readjudication against your real contracts → dispute → report to client → response.
          </p>
        </div>
        {canManageOrg && (
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-muted-foreground">Contingency fee</span>
            <input
              type="number" min={0} max={100} step={0.5}
              placeholder={currentFeePct}
              value={feeInput ?? ''}
              onChange={e => setFeeInput(e.target.value)}
              className="h-7 w-16 px-1.5 rounded border bg-background text-right font-mono"
            />
            <span className="text-muted-foreground">%</span>
            <button
              onClick={saveFee}
              disabled={savingFee || feeInput === null}
              className="h-7 px-2 rounded border bg-card hover:bg-muted disabled:opacity-50 text-[11px] font-medium"
            >
              {savingFee ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </header>

      {!canManageOrg && Number(currentFeePct) === 0 && (
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-[11.5px] text-muted-foreground">
          No contingency fee is configured for this org yet — an admin/owner can set one above. Until then, recovered disputes assess no fee.
        </div>
      )}

      <div className="rounded-lg border bg-card">
        {loading ? <div className="p-6 text-sm text-muted-foreground">Loading…</div> :
         disputes.length === 0 ? <div className="p-6 text-sm text-muted-foreground">No disputes yet. Import an 835 remittance batch with an on-file payer contract to detect underpayments automatically.</div> :
         <table className="w-full text-[12.5px]">
           <thead className="text-muted-foreground border-b">
             <tr>
               <th className="text-left p-2">Claim</th>
               <th className="text-left p-2">Payer</th>
               <th className="text-left p-2">CPT</th>
               <th className="text-right p-2">Expected</th>
               <th className="text-right p-2">Paid</th>
               <th className="text-right p-2">Variance</th>
               <th className="text-left p-2">Severity</th>
               <th className="text-left p-2">Status</th>
               <th className="text-right p-2">Fee</th>
               <th className="text-left p-2">Report</th>
               <th className="text-left p-2">Client Response</th>
             </tr>
           </thead>
           <tbody>
             {disputes.map(d => (
               <tr key={d.dispute_id} className="border-b hover:bg-muted/30 align-top">
                 <td className="p-2 font-mono">{d.claim_id}</td>
                 <td className="p-2">{d.payer_name}</td>
                 <td className="p-2 font-mono">{d.procedure_code ?? '—'}</td>
                 <td className="p-2 text-right font-mono">{formatCents(d.expected_amount_cents)}</td>
                 <td className="p-2 text-right font-mono">{formatCents(d.paid_amount_cents)}</td>
                 <td className="p-2 text-right font-mono text-status-denied">{formatCents(d.variance_amount_cents)} ({d.variance_percent.toFixed(1)}%)</td>
                 <td className="p-2"><span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase ${SEVERITY_TONE[d.severity] ?? ''}`}>{d.severity}</span></td>
                 <td className="p-2">
                   {canApprove && d.status !== 'closed' ? (
                     <select defaultValue={d.status} onChange={e => setStatus(d.dispute_id, e.target.value)}
                       className="h-7 px-1 text-[11px] rounded border bg-background">
                       <option value="open">Open</option>
                       <option value="in_review">In Review</option>
                       <option value="submitted">Submitted</option>
                       <option value="recovered">Recovered</option>
                       <option value="closed">Closed</option>
                     </select>
                   ) : d.status}
                 </td>
                 <td className="p-2 text-right font-mono">
                   {d.assessed_fee_cents > 0 ? formatCents(d.assessed_fee_cents)
                     : d.status === 'recovered' ? '—' : d.fee_percent_bps > 0 ? `${(d.fee_percent_bps / 100).toFixed(1)}% on recovery` : 'none'}
                 </td>
                 <td className="p-2">
                   <div className="flex items-center gap-1.5">
                     <button onClick={() => generateReport(d)} title="Download recovery report PDF"
                       className="h-7 w-7 inline-flex items-center justify-center rounded border bg-card hover:bg-muted">
                       <FileDown className="h-3.5 w-3.5" />
                     </button>
                     {d.report_generated_at && !d.report_sent_at && (
                       <button onClick={() => markSent(d)} title="Mark sent to client (delivery is manual)"
                         className="h-7 w-7 inline-flex items-center justify-center rounded border bg-card hover:bg-muted">
                         <Send className="h-3.5 w-3.5" />
                       </button>
                     )}
                     {d.report_sent_at && <span className="text-[10px] text-muted-foreground">Sent {d.report_sent_at.slice(0, 10)}</span>}
                   </div>
                 </td>
                 <td className="p-2">
                   {d.report_sent_at ? (
                     canApprove ? (
                       <select defaultValue={d.client_response ?? 'pending'} onChange={e => respondAs(d.dispute_id, e.target.value as ClientResponse)}
                         className="h-7 px-1 text-[11px] rounded border bg-background">
                         <option value="pending">Pending</option>
                         <option value="approved_pursue">Approved — Pursue</option>
                         <option value="declined">Declined</option>
                         <option value="handling_internally">Handling Internally</option>
                       </select>
                     ) : (RESPONSE_LABEL[d.client_response ?? 'pending'])
                   ) : <span className="text-[11px] text-muted-foreground italic">Report not sent</span>}
                 </td>
               </tr>
             ))}
           </tbody>
         </table>}
      </div>
    </div>
  );
}
