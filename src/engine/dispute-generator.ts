/**
 * Phase 15 — Dispute Generator.
 * Bridges contract underpayment detection into existing recovery workflows by
 * persisting an underpayment_dispute row (which existing Recovery Ops / Executive
 * dashboards consume).  Reuses ops_events for audit; does NOT create a parallel
 * case/queue system — Recovery Operations picks up disputes via list queries.
 */
import { createDispute } from '@/lib/contracts';
import type { UnderpaymentResult } from './contract-underpayment';
import type { PayerContract } from '@/types/contracts';
import type { UnderpaymentDispute } from '@/types/contracts';

export interface DisputeGenInput {
  claim_id: string;
  payer_name: string;
  procedure_code?: string | null;
  service_date?: string | null;
  contract?: PayerContract | null;
  contract_id?: string | null;
  allowed_cents: number;
  paid_cents: number;
  underpayment: UnderpaymentResult;
}

const AUTO_OPEN_MIN_VARIANCE_CENTS = 5_00; // $5

export async function maybeGenerateDispute(input: DisputeGenInput): Promise<UnderpaymentDispute | null> {
  const { underpayment } = input;
  if (!underpayment.is_underpayment) return null;
  if (underpayment.variance_cents < AUTO_OPEN_MIN_VARIANCE_CENTS) return null;

  return createDispute({
    claim_id: input.claim_id,
    contract_id: input.contract?.contract_id ?? input.contract_id ?? null,
    payer_name: input.payer_name,
    procedure_code: input.procedure_code ?? null,
    service_date: input.service_date ?? null,
    expected_amount_cents: underpayment.expected_cents,
    allowed_amount_cents: input.allowed_cents,
    paid_amount_cents: input.paid_cents,
    variance_amount_cents: underpayment.variance_cents,
    variance_percent: underpayment.variance_percent,
    severity: underpayment.severity,
    status: 'open',
    explanation: underpayment.explanation,
  }, { auto: true });
}
