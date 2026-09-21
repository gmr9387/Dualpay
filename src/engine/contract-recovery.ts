/**
 * Phase 21 — Contract Recovery Sweep.
 * The "review -> readjudication" step of the recovery workflow: for every
 * remittance line from an 835 import, match it to the real, currently
 * effective fee schedule for its payer + procedure code, readjudicate what
 * should have been paid, and open an underpayment_dispute when the payer
 * paid less than the contract requires. Fee assessment and the client
 * report happen later, from the dispute itself (see contracts.ts).
 */
import { findFeeScheduleForClaim } from '@/lib/contracts';
import { appendOpsEvent } from '@/lib/ops-events';
import { appendLineageEvent } from '@/lib/lineage';
import { detectUnderpayment } from './contract-underpayment';
import { maybeGenerateDispute } from './dispute-generator';
import type { RemittanceLineRow } from '@/lib/lineage';

export interface ContractRecoverySweepResult {
  matched: number;
  unmatched: number;
  disputes_opened: number;
}

export async function runContractRecoverySweep(
  lines: RemittanceLineRow[],
  batchId: string,
): Promise<ContractRecoverySweepResult> {
  const candidates = lines.filter(l => l.claim_id && l.payer_name && l.procedure_code);
  if (candidates.length === 0) return { matched: 0, unmatched: 0, disputes_opened: 0 };

  await appendOpsEvent({
    kind: 'contract_recovery_started',
    summary: `Contract recovery sweep started for batch ${batchId.slice(0, 8)} · ${candidates.length} line(s)`,
    payload: { batch_id: batchId, line_count: candidates.length },
  });

  let matched = 0;
  let unmatched = 0;
  let disputesOpened = 0;

  for (const line of candidates) {
    const match = await findFeeScheduleForClaim(line.payer_name!, line.procedure_code!, line.service_date);
    if (!match) {
      unmatched++;
      await appendOpsEvent({
        kind: 'contract_match_missing',
        claim_id: line.claim_id,
        summary: `No effective contract/fee schedule for ${line.payer_name} · CPT ${line.procedure_code}`,
        payload: { batch_id: batchId, remittance_line_id: line.remittance_line_id },
      });
      continue;
    }
    matched++;
    await appendOpsEvent({
      kind: 'contract_match_found',
      claim_id: line.claim_id,
      summary: `Matched ${line.payer_name} · CPT ${line.procedure_code} to contract ${match.contract_id}`,
      payload: { batch_id: batchId, contract_id: match.contract_id, fee_schedule_id: match.fee.fee_schedule_id },
    });

    const underpayment = detectUnderpayment({
      billed_cents: line.billed_amount_cents,
      allowed_cents: line.allowed_amount_cents,
      paid_cents: line.paid_amount_cents,
      fee: match.fee,
    });

    if (!underpayment.is_underpayment) continue;

    await appendLineageEvent({
      claim_id: line.claim_id,
      remittance_line_id: line.remittance_line_id,
      event_type: 'underpayment_detected',
      event_summary: `Underpayment detected: ${line.claim_id} · ${underpayment.explanation}`,
      payload: { batch_id: batchId, variance_cents: underpayment.variance_cents, severity: underpayment.severity },
    });

    const dispute = await maybeGenerateDispute({
      claim_id: line.claim_id!,
      payer_name: line.payer_name!,
      procedure_code: line.procedure_code,
      service_date: line.service_date,
      contract_id: match.contract_id,
      allowed_cents: line.allowed_amount_cents,
      paid_cents: line.paid_amount_cents,
      underpayment,
    });
    if (dispute) disputesOpened++;
  }

  await appendOpsEvent({
    kind: 'contract_recovery_completed',
    summary: `Contract recovery sweep completed for batch ${batchId.slice(0, 8)} · ${matched} matched, ${unmatched} unmatched, ${disputesOpened} dispute(s) opened`,
    payload: { batch_id: batchId, matched, unmatched, disputes_opened: disputesOpened },
  });

  return { matched, unmatched, disputes_opened: disputesOpened };
}
