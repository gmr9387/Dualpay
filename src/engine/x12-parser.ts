/**
 * Phase 21 — X12 Parser
 *
 * Pure, deterministic X12 parser for 835/837P/837I.
 * - Detects ISA delimiters from the first ISA segment.
 * - Splits into segments and elements without external deps.
 * - Identifies envelope control numbers (ISA, GS, ST/SE/GE/IEA).
 * - Classifies transaction type from ST01 + (when 837) loop hints.
 */

import type {
  EdiEnvelope,
  EdiSegment,
  EdiTransactionType,
  ParsedX12,
} from '@/types/edi';

const DEFAULT_SEG_TERM = '~';
const DEFAULT_ELEM_SEP = '*';
const DEFAULT_SUB_SEP = ':';

export interface ParseOptions {
  filename?: string;
}

function detectDelimiters(raw: string): {
  element: string;
  segment: string;
  subElement: string;
} {
  const isaIdx = raw.indexOf('ISA');
  if (isaIdx < 0) {
    return { element: DEFAULT_ELEM_SEP, segment: DEFAULT_SEG_TERM, subElement: DEFAULT_SUB_SEP };
  }
  // The element separator is the 4th character after "ISA"
  // ISA*... — element separator is raw[isaIdx + 3]
  const element = raw[isaIdx + 3] ?? DEFAULT_ELEM_SEP;
  // ISA is fixed-length 106 chars; sub-element sep at position 104, segment term at 105
  const subElement = raw[isaIdx + 104] ?? DEFAULT_SUB_SEP;
  let segment = raw[isaIdx + 105] ?? DEFAULT_SEG_TERM;
  if (segment === '\n' || segment === '\r') segment = DEFAULT_SEG_TERM;
  return { element, segment, subElement };
}

function splitSegments(body: string, terminator: string): string[] {
  // Allow optional whitespace/newlines after terminator
  return body
    .split(terminator)
    .map((s) => s.replace(/^[\r\n\s]+/, '').replace(/[\r\n\s]+$/, ''))
    .filter((s) => s.length > 0);
}

function elementsOf(segment: string, elementSep: string): string[] {
  return segment.split(elementSep);
}

function classifyTransaction(st01: string, segments: EdiSegment[]): EdiTransactionType {
  if (st01 === '835') return '835';
  if (st01 === '837') {
    // Look for ST or BHT or CLM segments to find P/I distinguisher
    // 837 uses CLM05-1 (facility type) OR GS08 implementation reference for P vs I
    const gs = segments.find((s) => s.segment_type === 'GS');
    const gs08 = gs?.parsed_json.GS08 ?? '';
    if (gs08.includes('X222')) return '837P';
    if (gs08.includes('X223')) return '837I';
    // Fallback: look for facility codes in CLM05
    const clm = segments.find((s) => s.segment_type === 'CLM');
    const facility = clm?.parsed_json.CLM05_1 ?? '';
    if (/^(11|12|13|14|15|16|17|18|19|20|21|22|23)$/.test(facility)) {
      return facility.startsWith('11') ? '837P' : '837I';
    }
    return '837P';
  }
  return 'unknown';
}

function buildSegment(raw: string, seq: number, elementSep: string): EdiSegment {
  const parts = elementsOf(raw, elementSep);
  const type = parts[0] ?? '';
  const parsed: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    parsed[`${type}${String(i).padStart(2, '0')}`] = parts[i];
  }
  // Also expose sub-element 1 of first element when present (e.g. CLM05_1)
  // Best-effort only — leave heavy sub-parsing to normalizers.
  for (let i = 1; i < parts.length; i++) {
    if (parts[i]?.includes(':')) {
      const subs = parts[i].split(':');
      subs.forEach((v, idx) => {
        parsed[`${type}${String(i).padStart(2, '0')}_${idx + 1}`] = v;
      });
    }
  }
  return {
    segment_type: type,
    sequence_number: seq,
    raw_segment: raw,
    parsed_json: parsed,
  };
}

export function parseX12(raw: string, _opts: ParseOptions = {}): ParsedX12 {
  const cleaned = raw.replace(/\uFEFF/g, '');
  const { element, segment, subElement } = detectDelimiters(cleaned);
  const rawSegments = splitSegments(cleaned, segment);
  const segments: EdiSegment[] = rawSegments.map((s, i) => buildSegment(s, i + 1, element));

  const isa = segments.find((s) => s.segment_type === 'ISA');
  const gs = segments.find((s) => s.segment_type === 'GS');
  const st = segments.find((s) => s.segment_type === 'ST');

  const st01 = st?.parsed_json.ST01 ?? '';
  const transaction_type = classifyTransaction(st01, segments);

  const envelope: EdiEnvelope = {
    sender_id: isa?.parsed_json.ISA06?.trim(),
    receiver_id: isa?.parsed_json.ISA08?.trim(),
    interchange_control_number: isa?.parsed_json.ISA13?.trim(),
    functional_group_number: gs?.parsed_json.GS06?.trim(),
    transaction_set_number: st?.parsed_json.ST02?.trim(),
    transaction_type,
  };

  return {
    envelope,
    segments,
    element_separator: element,
    segment_terminator: segment,
    sub_element_separator: subElement,
  };
}

export function isLikelyX12(raw: string): boolean {
  return /^[\s\uFEFF]*ISA[*|^]/.test(raw);
}
