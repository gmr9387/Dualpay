/**
 * Contract recovery report PDF — the client-facing document generated for
 * an underpayment_dispute. Presents what was billed, what the contract
 * required, what the payer actually paid, and the options the client can
 * choose between. Client-side jsPDF, same approach as pdf-appeal.ts.
 */
import { jsPDF } from 'jspdf';
import type { UnderpaymentDispute } from '@/types/contracts';

interface ReportArgs {
  dispute: UnderpaymentDispute;
  orgName?: string;
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildRecoveryReportPdf(args: ReportArgs): jsPDF {
  const { dispute, orgName } = args;

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = margin;

  const h1 = (t: string) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(t, margin, y); y += 22; };
  const h2 = (t: string) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(t, margin, y); y += 16; };
  const p  = (t: string, opts?: { muted?: boolean }) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    if (opts?.muted) doc.setTextColor(110);
    const lines = doc.splitTextToSize(t, pageW - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 12;
    doc.setTextColor(0);
  };
  const kv = (k: string, v: string) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(80);
    doc.text(k.toUpperCase(), margin, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(0);
    doc.text(v, margin + 160, y);
    y += 14;
  };
  const hr = () => { doc.setDrawColor(220); doc.line(margin, y, pageW - margin, y); y += 10; };

  h1('Contract Recovery Report');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100);
  doc.text(`${orgName ?? 'Provider Organization'} · Generated ${new Date().toLocaleString('en-US')}`, margin, y);
  y += 18; doc.setTextColor(0);
  hr();

  h2('Claim');
  kv('Claim ID', dispute.claim_id);
  kv('Payer', dispute.payer_name);
  kv('Procedure code', dispute.procedure_code ?? '—');
  kv('Service date', dispute.service_date?.slice(0, 10) ?? '—');
  y += 8; hr();

  h2('Readjudication — What the Contract Required');
  kv('Expected reimbursement', money(dispute.expected_amount_cents));
  kv('Payer allowed', money(dispute.allowed_amount_cents));
  kv('Payer paid', money(dispute.paid_amount_cents));
  kv('Variance', `${money(dispute.variance_amount_cents)} (${dispute.variance_percent.toFixed(1)}%)`);
  kv('Severity', String(dispute.severity).toUpperCase());
  y += 4;
  if (dispute.explanation) p(dispute.explanation, { muted: true });
  y += 4; hr();

  h2('Recovery Fee');
  if (dispute.fee_percent_bps > 0) {
    kv('Fee rate', `${(dispute.fee_percent_bps / 100).toFixed(1)}% of recovered amount`);
    kv('Assessed fee', dispute.assessed_fee_cents > 0 ? money(dispute.assessed_fee_cents) : 'Assessed only upon recovery');
  } else {
    p('No fee has been assessed on this dispute. Fees, where applicable, are contingency-based — charged only on a percentage of money actually recovered, never up front.', { muted: true });
  }
  y += 4; hr();

  h2('Your Options');
  p('1. Approve pursuit — DualPay pursues this dispute with the payer on your behalf.');
  p('2. Decline — close this dispute with no further action.');
  p('3. Handle internally — your team pursues this dispute directly; DualPay takes no further action.');
  y += 8; hr();

  // Footer disclaimer
  y = doc.internal.pageSize.getHeight() - margin - 40;
  doc.setDrawColor(220); doc.line(margin, y, pageW - margin, y); y += 12;
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(110);
  const disclaimer = 'This report is generated from your own remitted claims data matched against your on-file payer contracts. Record your decision in DualPay so the dispute can proceed accordingly.';
  const lines = doc.splitTextToSize(disclaimer, pageW - margin * 2);
  doc.text(lines, margin, y);

  return doc;
}

export function downloadRecoveryReportPdf(args: ReportArgs): string {
  const doc = buildRecoveryReportPdf(args);
  const filename = `recovery-report-${args.dispute.claim_id}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
}
