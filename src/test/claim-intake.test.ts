/**
 * Claim intake — proves the previously-missing link actually works:
 * a real 837 claim, once normalized, produces per-line detail (not
 * just an aggregate) and maps to a real, adjudicatable Claim.
 */
import { describe, it, expect } from 'vitest';
import { parseX12 } from '@/engine/x12-parser';
import { normalize837 } from '@/engine/edi-normalizer';
import { canonicalClaim837ToClaim } from '@/engine/claim-intake';

// Mirrors the real two-line 837P this fix was built against: two
// service lines with distinct billed amounts, units, and a shared
// claim-level diagnosis pointer.
const FIXTURE_837P_TWO_LINES = [
  'ISA*00*          *01*          *ZZ*TESTPROVIDER    *ZZ*TESTPAYER       *260921*2303*^*00501*000000002*0*T*:~',
  'GS*HC*TESTPROVIDER*TESTPAYER*20260921*2303*2*X*005010X222A1~',
  'ST*837*0001*005010X222A1~',
  'BHT*0019*00*TEST837000001*20260921*2303*CH~',
  'NM1*41*2*TEST MEDICAL GROUP*****46*TESTPROVIDER001~',
  'PER*IC*TEST BILLING OFFICE*TE*5555550100~',
  'NM1*40*2*TEST HEALTH PLAN*****46*TESTPAYER001~',
  'HL*1**20*1~',
  'NM1*85*2*TEST MEDICAL GROUP*****XX*TESTPROVIDER001~',
  'N3*100 TEST AVENUE~',
  'N4*DETROIT*MI*48201~',
  'REF*EI*123456789~',
  'HL*2*1*22*0~',
  'SBR*P*18*******MC~',
  'NM1*IL*1*TEST*PATIENT****MI*TESTMEMBER001~',
  'N3*200 TEST STREET~',
  'N4*DETROIT*MI*48202~',
  'DMG*D8*19850101*M~',
  'NM1*PR*2*TEST HEALTH PLAN*****PI*TESTPAYER001~',
  'CLM*TESTCLM001*500.00***11:B:1*Y*A*Y*Y~',
  'DTP*434*D8*20260901~',
  'DTP*435*D8*20260905~',
  'HI*ABK:M5450~',
  'LX*1~',
  'SV1*HC:99213*200.00*UN*1***1~',
  'DTP*472*D8*20260901~',
  'LX*2~',
  'SV1*HC:93000*300.00*UN*1***1~',
  'DTP*472*D8*20260901~',
  'SE*29*0001~',
  'GE*1*2~',
  'IEA*1*000000002~',
].join('');

describe('normalize837 — per-line detail', () => {
  const claims = normalize837(parseX12(FIXTURE_837P_TWO_LINES));

  it('produces one claim with two lines, not a flattened aggregate', () => {
    expect(claims).toHaveLength(1);
    expect(claims[0].lines).toHaveLength(2);
  });

  it('captures each line\'s own billed amount and procedure code', () => {
    const [l1, l2] = claims[0].lines;
    expect(l1.procedure_code).toBe('99213');
    expect(l1.billed_cents).toBe(20000);
    expect(l1.units).toBe(1);
    expect(l2.procedure_code).toBe('93000');
    expect(l2.billed_cents).toBe(30000);
  });

  it('resolves the HI diagnosis pointer onto each line', () => {
    for (const line of claims[0].lines) {
      expect(line.diagnosis_codes).toEqual(['M5450']);
    }
  });

  it('attaches each line\'s own DTP*472 service date, not the claim-level DTP*434', () => {
    for (const line of claims[0].lines) {
      expect(line.service_date).toBe('2026-09-01');
    }
  });

  it('still exposes the claim-level payer_name and total for existing callers', () => {
    expect(claims[0].payer_name).toBe('TEST HEALTH PLAN');
    expect(claims[0].billed_cents).toBe(50000);
  });
});

describe('canonicalClaim837ToClaim — maps a normalized 837 to a real Claim', () => {
  const claims = normalize837(parseX12(FIXTURE_837P_TWO_LINES));
  const claim = canonicalClaim837ToClaim(claims[0]);

  it('produces a Claim with real per-line ClaimLine records', () => {
    expect(claim.claim_id).toBe('TESTCLM001');
    expect(claim.member_id).toBe('TESTMEMBER001');
    expect(claim.lines).toHaveLength(2);
    expect(claim.lines[0]).toMatchObject({
      claim_id: 'TESTCLM001',
      claim_line_number: 1,
      procedure_code: '99213',
      billed_amount: 20000,
      units: 1,
      diagnosis_codes: ['M5450'],
    });
    expect(claim.lines[1]).toMatchObject({
      claim_line_number: 2,
      procedure_code: '93000',
      billed_amount: 30000,
    });
  });

  it('is immediately adjudicatable: status RECEIVED with a real payer_name in intel', () => {
    expect(claim.status).toBe('RECEIVED');
    expect(claim.intel?.payer_name).toBe('TEST HEALTH PLAN');
  });

  it('derives service_date_from/to from the actual line dates', () => {
    expect(claim.service_date_from).toBe('2026-09-01');
    expect(claim.service_date_to).toBe('2026-09-01');
  });

  it('sums line detail correctly against the claim total', () => {
    const lineSum = claim.lines.reduce((sum, l) => sum + l.billed_amount, 0);
    expect(lineSum).toBe(claim.total_billed);
  });
});

describe('canonicalClaim837ToClaim — degenerate fallback', () => {
  it('falls back to one line per procedure code when no line detail parsed', () => {
    const claim = canonicalClaim837ToClaim({
      claim_id: 'DEGEN-1',
      payer_name: 'FALLBACK PAYER',
      billed_cents: 10000,
      procedure_codes: ['99213', '93000'],
      lines: [],
      form_type: '837P',
    });
    expect(claim.lines).toHaveLength(2);
    expect(claim.lines[0].billed_amount + claim.lines[1].billed_amount).toBe(10000);
  });
});
