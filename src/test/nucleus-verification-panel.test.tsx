import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { Claim } from '@/types/claim';
import type { ClaimIntel } from '@/types/clarity';

vi.mock('@/engine/nucleus-guardian-status-client', () => ({
  checkNucleusGuardianStatus: vi.fn(),
}));
vi.mock('@/engine/nucleus-weaver-client', () => ({
  scoreViaNucleusWeaver: vi.fn(),
}));
vi.mock('@/engine/nucleus-adjudication-client', () => ({
  adjudicateViaNucleus: vi.fn(),
}));

import { checkNucleusGuardianStatus } from '@/engine/nucleus-guardian-status-client';
import { scoreViaNucleusWeaver } from '@/engine/nucleus-weaver-client';
import { adjudicateViaNucleus } from '@/engine/nucleus-adjudication-client';
import { NucleusVerificationPanel } from '@/components/admin/NucleusVerificationPanel';

const checkGuardianMock = checkNucleusGuardianStatus as unknown as ReturnType<typeof vi.fn>;
const scoreWeaverMock = scoreViaNucleusWeaver as unknown as ReturnType<typeof vi.fn>;
const adjudicateMock = adjudicateViaNucleus as unknown as ReturnType<typeof vi.fn>;

const claim: Claim = {
  claim_id: 'CLM-1',
  member_id: 'MBR-1',
  provider_npi: '1234567890',
  provider_name: 'Test Provider',
  claim_type: 'professional',
  received_date: '2026-01-01',
  service_date_from: '2026-01-01',
  service_date_to: '2026-01-01',
  total_billed: 10000,
  lines: [
    {
      line_id: 'LINE-1',
      claim_id: 'CLM-1',
      service_date: '2026-01-01',
      claim_line_number: 1,
      procedure_code: '99213',
      diagnosis_codes: ['R51'],
      billed_amount: 10000,
      units: 1,
      place_of_service: '11',
    },
  ],
  ohi_indicators: [],
  status: 'RECEIVED',
};

// A real ClaimIntel envelope, the shape rowToClaim() (the only real
// claim-creation path in this repo) actually produces -- payer_name is
// required whenever intel is present.
const intel: ClaimIntel = {
  payer_id: 'ACME',
  payer_name: 'Acme Health Plan',
  payer_class: 'commercial',
  submitted_at: '2026-01-01T00:00:00.000Z',
  aging_days: 5,
  aging_bucket: '0-30',
  reimbursement_state: 'submitted',
  expected_reimbursement_cents: 10000,
  actual_reimbursement_cents: 0,
  underpayment_cents: 0,
  amount_at_risk_cents: 0,
  recoverability_score: 60,
  severity: 'low',
  workflow_owner: 'biller',
  sla_due_at: '2026-01-15T00:00:00.000Z',
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

const claimWithIntel: Claim = { ...claim, intel };

afterEach(() => {
  cleanup();
  checkGuardianMock.mockReset();
  scoreWeaverMock.mockReset();
  adjudicateMock.mockReset();
});

describe('NucleusVerificationPanel', () => {
  it('shows real configured results from both real proxy calls, and skips adjudication without a payer name', async () => {
    checkGuardianMock.mockResolvedValue({
      configured: true,
      safe_to_process: true,
      kill_switch_active: false,
      reason: null,
      activated_by: null,
      kill_switch_updated_at: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    scoreWeaverMock.mockResolvedValue({
      configured: true,
      stage: 'opportunity',
      score: 42.5,
      fired_rules: ['high-cost-procedure'],
      claim_id: 'CLM-1',
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    render(<NucleusVerificationPanel claim={claim} />);

    expect(screen.getByText('Nucleus Verification')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Safe to process')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByText(/42\.5 \/ 100 · high-cost-procedure/)).toBeInTheDocument(),
    );

    // claim (no intel envelope) should never call adjudicateViaNucleus --
    // there is no real payer_name to send, and it must not be guessed.
    expect(adjudicateMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Payer name not available for this claim/),
    ).toBeInTheDocument();

    // Confirms the real claim's own facts (not fabricated data) are what
    // gets sent to nucleus's real scoring endpoint.
    expect(scoreWeaverMock).toHaveBeenCalledWith({
      stage: 'opportunity',
      claim_id: 'CLM-1',
      facts: {
        claim_type: 'professional',
        total_billed_cents: 10000,
        line_count: 1,
        procedure_codes: ['99213'],
        diagnosis_codes: ['R51'],
        ohi_count: 0,
      },
    });
  });

  it('shows a clear "not configured" state instead of erroring when nucleus secrets are unset', async () => {
    checkGuardianMock.mockResolvedValue({
      configured: false,
      error: 'Nucleus Guardian status is not configured...',
    });
    scoreWeaverMock.mockResolvedValue({
      configured: false,
      error: 'Nucleus Weaver scoring is not configured...',
    });

    render(<NucleusVerificationPanel claim={claim} />);

    await waitFor(() =>
      expect(screen.getAllByText("Not configured on nucleus's side yet")).toHaveLength(2),
    );
  });

  it('surfaces a thrown error distinctly rather than crashing the panel', async () => {
    checkGuardianMock.mockRejectedValue(new Error('network down'));
    scoreWeaverMock.mockResolvedValue({
      configured: false,
      error: 'not configured',
    });

    render(<NucleusVerificationPanel claim={claim} />);

    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument());
  });

  it('adjudicates each real line via nucleus using the real intel.payer_name, not a guess', async () => {
    checkGuardianMock.mockResolvedValue({
      configured: true,
      safe_to_process: true,
      kill_switch_active: false,
      reason: null,
      activated_by: null,
      kill_switch_updated_at: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    scoreWeaverMock.mockResolvedValue({
      configured: false,
      error: 'not configured',
    });
    adjudicateMock.mockResolvedValue({
      configured: true,
      decision: 'allow',
      reason: 'Within contracted allowed amount',
      adjudication: {
        status: 'adjudicated',
        allowed: 8000,
        plan_paid: 6400,
        member_responsibility: 1600,
        deductible_applied: 0,
        coinsurance: 1600,
      },
      risk_tier: 'low',
      contract_id: 'CTR-1',
      plan_id: 'PLN-1',
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    render(<NucleusVerificationPanel claim={claimWithIntel} />);

    await waitFor(() =>
      expect(
        screen.getByText(/ALLOW · plan paid \$64\.00 · member owes \$16\.00 · risk low/),
      ).toBeInTheDocument(),
    );

    expect(adjudicateMock).toHaveBeenCalledWith({
      claim_id: 'CLM-1',
      member_id: 'MBR-1',
      payer_name: 'Acme Health Plan',
      procedure_code: '99213',
      provider_npi: '1234567890',
      diagnosis_codes: ['R51'],
      billed_amount_cents: 10000,
      units: 1,
      place_of_service: '11',
      service_date: '2026-01-01',
    });
  });

  it('shows a clear "not configured" state for adjudication without erroring', async () => {
    checkGuardianMock.mockResolvedValue({ configured: false, error: 'not configured' });
    scoreWeaverMock.mockResolvedValue({ configured: false, error: 'not configured' });
    adjudicateMock.mockResolvedValue({ configured: false, error: 'not configured' });

    render(<NucleusVerificationPanel claim={claimWithIntel} />);

    await waitFor(() =>
      expect(screen.getAllByText("Not configured on nucleus's side yet")).toHaveLength(3),
    );
  });
});
