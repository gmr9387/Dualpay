/**
 * Phase 23 — Payer Findings (payment integrity / "find lost money").
 *
 * Same engine, same data pipeline as Contract Recovery (Phase 15/21) —
 * reframed for a payer audience instead of a provider one. Where
 * Contract Recovery shows underpayment disputes (provider was shorted),
 * this page shows the mirror direction: claims where the payer paid
 * more than the contract required, surfaced by the same
 * detectUnderpayment() engine now generalized to flag both directions.
 *
 * COB conflicts flagged comes from remittance_batches.cob_count — a
 * real, already-persisted count from every committed 835 import, not a
 * new metric invented for this page.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDisputes } from '@/hooks/use-contracts';
import { useRemittanceBatches } from '@/hooks/use-remittance-batches';
import { updateDisputeStatus } from '@/lib/contracts';
import { formatCents, formatCentsCompact } from '@/hooks/use-clarity-data';
import { PageHeader, KpiStrip, ScrollBody, Panel, EmptyState } from '@/components/clarity/primitives';
import { can } from '@/lib/role-permissions';
import { useOrg } from '@/hooks/use-org';
import { Search, FileText } from 'lucide-react';

const SEVERITY_TONE: Record<string, string> = {
  critical: 'bg-status-denied/15 text-status-denied border-status-denied/30',
  high:     'bg-status-pending/20 text-status-pending border-status-pending/30',
  medium:   'bg-status-pending/10 text-status-pending border-status-pending/20',
  low:      'bg-muted text-muted-foreground border-border',
};

export default function PayerFindings() {
  const { disputes, loading, reload } = useDisputes();
  const { batches, loading: batchesLoading } = useRemittanceBatches();
  const { currentOrg } = useOrg();
  const canApprove = can.escalate(currentOrg?.role);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const findings = useMemo(() => disputes.filter(d => d.direction === 'overpayment'), [disputes]);
  const visible = useMemo(
    () => statusFilter === 'all' ? findings : findings.filter(d => d.status === statusFilter),
    [findings, statusFilter],
  );

  const stats = useMemo(() => {
    const totalFound = findings.reduce((s, d) => s + Math.abs(d.variance_amount_cents), 0);
    const recovered = findings.filter(d => d.status === 'recovered')
      .reduce((s, d) => s + Math.abs(d.variance_amount_cents), 0);
    const critical = findings.filter(d => d.severity === 'critical').length;
    const cobConflicts = batches.reduce((s, b) => s + b.cob_count, 0);
    return { totalFound, recovered, critical, cobConflicts, count: findings.length };
  }, [findings, batches]);

  const setStatus = async (id: string, status: string) => {
    await updateDisputeStatus(id, status);
    reload();
  };

  if (loading || batchesLoading) {
    return <div className="h-full flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Payer Findings"
        subtitle="Payment integrity — overpayments, COB conflicts, and processing efficiency surfaced from the same claim data providers use to recover underpayments."
      />
      <KpiStrip tiles={[
        { label: 'Money Found',       value: formatCentsCompact(stats.totalFound),  tone: 'amount-negative' },
        { label: 'Recouped',          value: formatCentsCompact(stats.recovered),   tone: 'amount-positive' },
        { label: 'Findings',          value: String(stats.count) },
        { label: 'Critical',          value: String(stats.critical), tone: stats.critical > 0 ? 'text-status-denied' : 'text-status-paid' },
        { label: 'COB Conflicts',     value: String(stats.cobConflicts), tone: 'text-status-cob' },
      ]} />
      <ScrollBody>
        <div className="p-5 space-y-4">
          <Panel title="Overpayment Findings" dense>
            {findings.length === 0 ? (
              <EmptyState
                icon={<Search className="h-5 w-5" />}
                title="No overpayments found yet"
                body="Import an 835 remittance batch with an on-file contract — the same readjudication engine used for provider recovery flags the payer-overpaid direction here automatically."
              />
            ) : (
              <>
                <div className="flex items-center gap-2 px-4 py-2 border-b text-[11.5px]">
                  <span className="text-muted-foreground">Status</span>
                  <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                    className="h-7 px-1.5 rounded border bg-background text-[11px]">
                    <option value="all">All</option>
                    <option value="open">Open</option>
                    <option value="in_review">In Review</option>
                    <option value="submitted">Submitted</option>
                    <option value="recovered">Recouped</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
                <table className="w-full text-[12.5px]">
                  <thead className="text-muted-foreground border-b">
                    <tr>
                      <th className="text-left p-2">Claim</th>
                      <th className="text-left p-2">Payer</th>
                      <th className="text-left p-2">CPT</th>
                      <th className="text-right p-2">Contracted</th>
                      <th className="text-right p-2">Paid</th>
                      <th className="text-right p-2">Overpaid</th>
                      <th className="text-left p-2">Severity</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(d => (
                      <tr key={d.dispute_id} className="border-b hover:bg-muted/30 align-top">
                        <td className="p-2 font-mono">
                          <Link to={`/claims/${d.claim_id}`} className="text-primary hover:underline">{d.claim_id}</Link>
                        </td>
                        <td className="p-2">
                          {d.contract_id ? (
                            <Link to={`/contracts/${d.contract_id}`} className="inline-flex items-center gap-1 text-primary hover:underline" title="View the contract & fee schedule this finding was matched against">
                              <FileText className="h-3 w-3" />{d.payer_name}
                            </Link>
                          ) : d.payer_name}
                        </td>
                        <td className="p-2 font-mono">{d.procedure_code ?? '—'}</td>
                        <td className="p-2 text-right font-mono">{formatCents(d.expected_amount_cents)}</td>
                        <td className="p-2 text-right font-mono">{formatCents(d.paid_amount_cents)}</td>
                        <td className="p-2 text-right font-mono text-status-denied">
                          {formatCents(Math.abs(d.variance_amount_cents))} ({Math.abs(d.variance_percent).toFixed(1)}%)
                        </td>
                        <td className="p-2">
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase ${SEVERITY_TONE[d.severity] ?? ''}`}>{d.severity}</span>
                        </td>
                        <td className="p-2">
                          {canApprove && d.status !== 'closed' ? (
                            <select defaultValue={d.status} onChange={e => setStatus(d.dispute_id, e.target.value)}
                              className="h-7 px-1 text-[11px] rounded border bg-background">
                              <option value="open">Open</option>
                              <option value="in_review">In Review</option>
                              <option value="submitted">Submitted</option>
                              <option value="recovered">Recouped</option>
                              <option value="closed">Closed</option>
                            </select>
                          ) : d.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Panel>
        </div>
      </ScrollBody>
    </div>
  );
}
