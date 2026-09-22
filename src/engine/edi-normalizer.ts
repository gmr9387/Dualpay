/**
 * Phase 21 — EDI Normalizer
 *
 * Converts parsed X12 transactions into the canonical models already
 * understood by Remittance Intelligence and Claims:
 *
 *   835  → CanonicalRemittance[]   (one per CLP claim group)
 *   837P → CanonicalClaim[]        (one per CLM)
 *   837I → CanonicalClaim[]        (one per CLM, facility marker)
 *
 * The output is intentionally minimal — downstream engines (contract
 * matching, denial intelligence, recovery factory) consume these shapes.
 */
import type { ParsedX12, EdiSegment } from '@/types/edi';
import type { CanonicalRemittance } from '@/types/import';

export interface CanonicalClaimLine837 {
  line_number: number;
  procedure_code: string;
  billed_cents: number;
  units: number;
  service_date?: string;
  diagnosis_codes: string[];
}

export interface CanonicalClaim837 {
  claim_id: string;
  payer_name: string;
  member_id?: string;
  provider_npi?: string;
  provider_name?: string;
  service_date?: string;
  billed_cents: number;
  procedure_codes: string[];
  /** Per-line detail (billed amount, units, diagnosis pointers) --
   * `procedure_codes`/`billed_cents` above stay claim-level aggregates
   * for existing callers; real adjudication needs this. */
  lines: CanonicalClaimLine837[];
  facility_type?: string;
  form_type: '837P' | '837I';
}

function money(v?: string): number {
  if (!v) return 0;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

function dateFrom(v?: string): string | undefined {
  if (!v) return undefined;
  // CCYYMMDD
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  // CCYYMMDD-CCYYMMDD range — take start
  const m = v.match(/^(\d{8})/);
  if (m) {
    const d = m[1];
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }
  return v;
}

/** Group segments into transaction sets (between ST and SE). */
function transactionSet(segments: EdiSegment[]): EdiSegment[] {
  const st = segments.findIndex((s) => s.segment_type === 'ST');
  const se = segments.findIndex((s) => s.segment_type === 'SE');
  if (st < 0 || se < 0) return segments;
  return segments.slice(st, se + 1);
}

/* ───────────────────────── 835 ───────────────────────── */

export function normalize835(parsed: ParsedX12): CanonicalRemittance[] {
  const segs = transactionSet(parsed.segments);
  const out: CanonicalRemittance[] = [];

  // Payer name from N1*PR; payment ref from TRN02; remit date from BPR16/DTM*405
  let payerName = 'Unknown Payer';
  let paymentRef: string | undefined;
  let remitDate: string | undefined;
  let n1Mode: 'PR' | 'PE' | null = null;

  for (const s of segs) {
    if (s.segment_type === 'N1') {
      const id = s.parsed_json.N101;
      if (id === 'PR') { payerName = s.parsed_json.N102 ?? payerName; n1Mode = 'PR'; }
      else if (id === 'PE') { n1Mode = 'PE'; }
      else { n1Mode = null; }
    }
    if (s.segment_type === 'TRN') paymentRef = s.parsed_json.TRN02 ?? paymentRef;
    if (s.segment_type === 'BPR') remitDate = dateFrom(s.parsed_json.BPR16);
    if (s.segment_type === 'DTM' && s.parsed_json.DTM01 === '405') {
      remitDate = dateFrom(s.parsed_json.DTM02) ?? remitDate;
    }
  }

  // Walk CLP groups
  let current: Partial<CanonicalRemittance> | null = null;
  let providerNpi: string | undefined;
  let providerName: string | undefined;

  const push = () => {
    if (current && current.claim_id) {
      const billed = current.billed_cents ?? 0;
      const paid = current.paid_cents ?? 0;
      const patient = current.patient_resp_cents ?? 0;
      const adj = current.adjustment_cents ?? Math.max(0, billed - paid - patient);
      out.push({
        claim_id: current.claim_id,
        payer_name: payerName,
        service_date: current.service_date,
        remittance_date: remitDate,
        payment_reference: paymentRef,
        check_number: paymentRef,
        billed_cents: billed,
        allowed_cents: current.allowed_cents ?? 0,
        paid_cents: paid,
        patient_resp_cents: patient,
        adjustment_cents: adj,
        carc_code: current.carc_code,
        rarc_code: current.rarc_code,
        group_code: current.group_code,
        denial_reason: current.denial_reason,
        procedure_code: current.procedure_code,
        member_id: current.member_id,
        provider_npi: providerNpi,
        provider_name: providerName,
      });
    }
    current = null;
  };

  for (const s of segs) {
    switch (s.segment_type) {
      case 'CLP': {
        push();
        current = {
          claim_id: s.parsed_json.CLP01,
          billed_cents: money(s.parsed_json.CLP03),
          paid_cents: money(s.parsed_json.CLP04),
          patient_resp_cents: money(s.parsed_json.CLP05),
        };
        break;
      }
      case 'NM1': {
        const code = s.parsed_json.NM101;
        if (current && code === 'QC') {
          current.member_id = s.parsed_json.NM109;
        }
        if (!current && (code === '82' || code === '85')) {
          providerName = s.parsed_json.NM103;
          if (s.parsed_json.NM108 === 'XX') providerNpi = s.parsed_json.NM109;
        }
        break;
      }
      case 'CAS': {
        if (!current) break;
        const group = (s.parsed_json.CAS01 ?? '').toUpperCase();
        const reason = s.parsed_json.CAS02;
        const amt = money(s.parsed_json.CAS03);
        if (['CO', 'PR', 'OA', 'PI', 'CR'].includes(group)) {
          current.group_code = group as CanonicalRemittance['group_code'];
        }
        if (reason) current.carc_code = reason;
        current.adjustment_cents = (current.adjustment_cents ?? 0) + amt;
        break;
      }
      case 'SVC': {
        if (!current) break;
        const proc = s.parsed_json.SVC01_2 ?? s.parsed_json.SVC01;
        current.procedure_code = proc;
        current.allowed_cents = (current.allowed_cents ?? 0) + money(s.parsed_json.SVC02);
        break;
      }
      case 'DTM': {
        if (!current) break;
        if (s.parsed_json.DTM01 === '472' || s.parsed_json.DTM01 === '232') {
          current.service_date = dateFrom(s.parsed_json.DTM02);
        }
        break;
      }
      case 'LQ': {
        if (current && s.parsed_json.LQ01 === 'HE') current.rarc_code = s.parsed_json.LQ02;
        break;
      }
      case 'MIA':
      case 'MOA': {
        if (current) current.denial_reason = current.denial_reason ?? s.raw_segment;
        break;
      }
    }
  }
  push();
  return out;
}

/* ───────────────────────── 837P / 837I ───────────────────────── */

export function normalize837(parsed: ParsedX12): CanonicalClaim837[] {
  const segs = transactionSet(parsed.segments);
  const form: '837P' | '837I' = parsed.envelope.transaction_type === '837I' ? '837I' : '837P';
  const out: CanonicalClaim837[] = [];

  let payerName = 'Unknown Payer';
  let providerNpi: string | undefined;
  let providerName: string | undefined;
  let memberId: string | undefined;
  let lastNmEntity: string | null = null;

  let current: Partial<CanonicalClaim837> | null = null;
  let procs: string[] = [];
  let lines: CanonicalClaimLine837[] = [];
  let lastLine: CanonicalClaimLine837 | null = null;
  let claimDiagnoses: string[] = [];

  const push = () => {
    if (current && current.claim_id) {
      out.push({
        claim_id: current.claim_id,
        payer_name: payerName,
        member_id: memberId,
        provider_npi: providerNpi,
        provider_name: providerName,
        service_date: current.service_date,
        billed_cents: current.billed_cents ?? 0,
        procedure_codes: procs.slice(),
        lines: lines.slice(),
        facility_type: current.facility_type,
        form_type: form,
      });
    }
    current = null;
    procs = [];
    lines = [];
    lastLine = null;
    claimDiagnoses = [];
  };

  for (const s of segs) {
    switch (s.segment_type) {
      case 'NM1': {
        const code = s.parsed_json.NM101;
        lastNmEntity = code ?? null;
        if (code === 'PR') payerName = s.parsed_json.NM103 ?? payerName;
        if (code === '85' || code === '87') {
          providerName = s.parsed_json.NM103 ?? providerName;
          if (s.parsed_json.NM108 === 'XX') providerNpi = s.parsed_json.NM109 ?? providerNpi;
        }
        if (code === 'IL' || code === 'QC') {
          memberId = s.parsed_json.NM109 ?? memberId;
        }
        break;
      }
      case 'CLM': {
        push();
        current = {
          claim_id: s.parsed_json.CLM01,
          billed_cents: money(s.parsed_json.CLM02),
          facility_type: s.parsed_json.CLM05_1,
        };
        break;
      }
      case 'HI': {
        if (!current) break;
        // HI*ABK:M5450*ABF:...~ — each element is qualifier:code; the
        // diagnosis codes themselves (the pointer target for SV107).
        for (let i = 1; i <= 12; i++) {
          const el = s.parsed_json[`HI${String(i).padStart(2, '0')}`];
          if (!el) continue;
          const code = el.split(':')[1];
          if (code) claimDiagnoses.push(code);
        }
        break;
      }
      case 'SV1': // Professional
      case 'SV2': // Institutional
      case 'SV3': {
        if (!current) break;
        const composite = s.parsed_json[`${s.segment_type}01`] ?? '';
        // SV1*HC:99213*200.00*UN*1***1 — HC:code, charge, unit basis,
        // units, (blank), (blank), diagnosis pointer(s).
        const parts = composite.split(':');
        const code = parts[1];
        if (code) procs.push(code);
        const lineBilled = money(s.parsed_json[`${s.segment_type}02`]);
        // billed_cents stays the claim-level total from CLM02 when
        // present (matches prior behavior for existing callers);
        // only backfill it from line sums if CLM02 was absent/zero.
        if (!current.billed_cents) {
          current.billed_cents = (current.billed_cents ?? 0) + lineBilled;
        }
        const unitsRaw = s.parsed_json[`${s.segment_type}04`];
        const units = unitsRaw ? parseFloat(unitsRaw) : 1;
        const pointerField = s.parsed_json[`${s.segment_type}07`];
        const pointers = pointerField ? pointerField.split(':').filter(Boolean) : [];
        const diagnosis_codes = pointers.length
          ? pointers
              .map((p) => claimDiagnoses[parseInt(p, 10) - 1])
              .filter((d): d is string => Boolean(d))
          : claimDiagnoses.slice();
        const line: CanonicalClaimLine837 = {
          line_number: lines.length + 1,
          procedure_code: code ?? '',
          billed_cents: lineBilled,
          units: Number.isFinite(units) && units > 0 ? units : 1,
          diagnosis_codes,
        };
        lines.push(line);
        lastLine = line;
        break;
      }
      case 'DTP': {
        if (!current) break;
        const qual = s.parsed_json.DTP01;
        if (qual === '472' || qual === '434') {
          const date = dateFrom(s.parsed_json.DTP03);
          // A 472 (service date) appearing after a line's SV1 belongs
          // to that line; a 434 (statement date range) is claim-level.
          if (qual === '472' && lastLine && !lastLine.service_date) {
            lastLine.service_date = date;
          }
          current.service_date = current.service_date ?? date;
        }
        break;
      }
    }
    void lastNmEntity;
  }
  push();
  return out;
}
