import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { Claim } from '@/types/claim';

vi.mock('@/engine/nucleus-guardian-status-client', () => ({
  checkNucleusGuardianStatus: vi.fn(),
}));
vi.mock('@/engine/nucleus-weaver-client', () => ({
  scoreViaNucleusWeaver: vi.fn(),
}));

import { checkNucleusGuardianStatus } from '@/engine/nucleus-guardian-status-client';
import { scoreViaNucleusWeaver } from '@/engine/nucleus-weaver-client';
import { NucleusVerificationPanel } from '@/components/admin/NucleusVerificationPanel';

const checkGuardianMock = checkNucleusGuardianStatus as unknown as ReturnType<typeof vi.fn>;
const scoreWeaverMock = scoreViaNucleusWeaver as unknown as ReturnType<typeof vi.fn>;

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

afterEach(() => {
  cleanup();
  checkGuardianMock.mockReset();
  scoreWeaverMock.mockReset();
});

describe('NucleusVerificationPanel', () => {
  it('shows real configured results from both real proxy calls', async () => {
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
});
