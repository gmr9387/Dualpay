/**
 * Claim Intake — maps a normalized 837 claim (edi-normalizer.ts's
 * CanonicalClaim837) into DualPay's real Claim type and persists it.
 *
 * This is the piece that was missing: normalize837() already existed
 * and EdiImport.tsx already called it, but nothing ever turned the
 * result into a real, adjudicatable Claim row. Without this, no 837
 * ever reached Claims Workbench regardless of how correctly it
 * parsed.
 */
import { saveClaim } from '@/data/repository';
import type { CanonicalClaim837 } from './edi-normalizer';
import type { Claim, ClaimLine } from '@/types/claim';
import type { ClaimIntel } from '@/types/clarity';

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown-payer';
}

function buildIntel(payerName: string, submittedAt: string): ClaimIntel {
  const slaDue = new Date(submittedAt);
  slaDue.setDate(slaDue.getDate() + 30);
  return {
    payer_id: slugify(payerName),
    payer_name: payerName,
    payer_class: 'commercial',
    submitted_at: submittedAt,
    aging_days: 0,
    aging_bucket: '0-30',
    reimbursement_state: 'submitted',
    expected_reimbursement_cents: 0,
    actual_reimbursement_cents: 0,
    underpayment_cents: 0,
    amount_at_risk_cents: 0,
    recoverability_score: 0,
    severity: 'low',
    workflow_owner: 'unassigned',
    sla_due_at: slaDue.toISOString(),
    is_escalated: false,
    is_high_value: false,
    is_stalled: false,
    denial_events: [],
    payer_responses: [],
    timeline: [],
    appeals: [],
    evidence_missing: [],
    notes: [],
    queues: [],
  };
}

/** Converts one normalized 837 claim into a real, adjudicatable Claim. */
export function canonicalClaim837ToClaim(c: CanonicalClaim837): Claim {
  const now = new Date().toISOString();
  const claimType = c.form_type === '837I' ? 'institutional' : 'professional';
  const placeOfService = c.facility_type || (claimType === 'professional' ? '11' : '21');

  const lines: ClaimLine[] = c.lines.length
    ? c.lines.map((line) => ({
        line_id: `${c.claim_id}-L${line.line_number}`,
        claim_id: c.claim_id,
        service_date: line.service_date ?? c.service_date ?? now.slice(0, 10),
        claim_line_number: line.line_number,
        procedure_code: line.procedure_code,
        diagnosis_codes: line.diagnosis_codes,
        billed_amount: line.billed_cents,
        units: line.units,
        place_of_service: placeOfService,
        rendering_provider_npi: c.provider_npi,
      }))
    : // Degenerate case: a claim with procedure codes but no parsed
      // line detail (e.g. malformed SV1 segments) -- fall back to one
      // line per code, splitting the claim total evenly rather than
      // silently dropping the claim.
      c.procedure_codes.map((code, i) => ({
        line_id: `${c.claim_id}-L${i + 1}`,
        claim_id: c.claim_id,
        service_date: c.service_date ?? now.slice(0, 10),
        claim_line_number: i + 1,
        procedure_code: code,
        diagnosis_codes: [],
        billed_amount: Math.round(c.billed_cents / Math.max(1, c.procedure_codes.length)),
        units: 1,
        place_of_service: placeOfService,
        rendering_provider_npi: c.provider_npi,
      }));

  const serviceDates = lines.map((l) => l.service_date).filter(Boolean).sort();
  const serviceDateFrom = serviceDates[0] ?? c.service_date ?? now.slice(0, 10);
  const serviceDateTo = serviceDates[serviceDates.length - 1] ?? serviceDateFrom;

  return {
    claim_id: c.claim_id,
    member_id: c.member_id ?? 'UNKNOWN',
    provider_npi: c.provider_npi ?? '',
    provider_name: c.provider_name ?? 'Unknown Provider',
    claim_type: claimType,
    received_date: now.slice(0, 10),
    service_date_from: serviceDateFrom,
    service_date_to: serviceDateTo,
    total_billed: c.billed_cents,
    lines,
    ohi_indicators: [],
    status: 'RECEIVED',
    intel: buildIntel(c.payer_name, now),
  };
}

export interface ClaimIntakeResult {
  imported: string[];
  failed: { claim_id: string; error: string }[];
}

/** Maps and persists every normalized 837 claim from one EDI file. */
export async function importClaims837(claims: CanonicalClaim837[]): Promise<ClaimIntakeResult> {
  const result: ClaimIntakeResult = { imported: [], failed: [] };
  for (const c of claims) {
    try {
      await saveClaim(canonicalClaim837ToClaim(c));
      result.imported.push(c.claim_id);
    } catch (err) {
      result.failed.push({ claim_id: c.claim_id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
