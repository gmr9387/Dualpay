/**
 * Recovery Factory — Deterministic validation engine.
 * No AI. Pure functions over mapped rows.
 */
import type {
  CanonicalField,
  FieldMapping,
  ImportSourceType,
  ParsedRow,
  RowIssue,
  ValidationLevel,
  ValidationSummary,
} from '@/types/import';
import { CANONICAL_FIELDS, REQUIRED_BY_SOURCE, fieldDef } from './import-schema';
import { lookupDenialEntry } from './denial-intelligence';

const MONEY_RE = /[^0-9.-]/g;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function parseMoneyCents(v: string): number | null {
  if (!v) return null;
  const cleaned = v.replace(MONEY_RE, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

function parseInteger(v: string): number | null {
  const n = parseInt(v.replace(/[^0-9-]/g, ''), 10);
  return isFinite(n) ? n : null;
}

function normalizeDate(v: string): string | null {
  if (!v) return null;
  if (DATE_RE.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function validateRows(
  rows: Record<string, string>[],
  mapping: FieldMapping,
  source: ImportSourceType,
): { parsed: ParsedRow[]; summary: ValidationSummary } {
  const required = REQUIRED_BY_SOURCE[source];
  const seenClaimIds = new Map<string, number>();
  const parsed: ParsedRow[] = [];
  const issuesByField: Record<string, number> = {};

  rows.forEach((raw, idx) => {
    const issues: RowIssue[] = [];
    const normalized: ParsedRow['normalized'] = {};

    for (const def of CANONICAL_FIELDS) {
      const srcCol = mapping[def.key];
      if (!srcCol) continue;
      const rawVal = (raw[srcCol] ?? '').toString().trim();
      if (!rawVal) continue;

      switch (def.kind) {
        case 'money': {
          const c = parseMoneyCents(rawVal);
          if (c === null) issues.push({ level: 'error', field: def.key, message: `Invalid amount in "${def.label}": "${rawVal}"` });
          else if (c < 0) issues.push({ level: 'warning', field: def.key, message: `Negative amount in "${def.label}"` });
          else normalized[def.key] = c;
          break;
        }
        case 'int': {
          const n = parseInteger(rawVal);
          if (n === null) issues.push({ level: 'warning', field: def.key, message: `Invalid integer "${rawVal}" for ${def.label}` });
          else normalized[def.key] = n;
          break;
        }
        case 'date': {
          const d = normalizeDate(rawVal);
          if (!d) issues.push({ level: 'warning', field: def.key, message: `Unparseable date "${rawVal}" for ${def.label}` });
          else normalized[def.key] = d;
          break;
        }
        default:
          normalized[def.key] = rawVal;
      }
    }

    // Required-field checks
    for (const r of required) {
      if (normalized[r] === undefined || normalized[r] === '' || normalized[r] === null) {
        issues.push({ level: 'error', field: r, message: `Missing required field: ${fieldDef(r).label}` });
      }
    }

    // CARC validity
    const carc = normalized.carc_code as string | undefined;
    if (carc) {
      const entry = lookupDenialEntry(carc, normalized.rarc_code as string | undefined);
      if (!entry && !/^[A-Z0-9]{1,8}$/.test(carc)) {
        issues.push({ level: 'warning', field: 'carc_code', message: `CARC "${carc}" not in taxonomy — will use generic mapping.` });
      }
    }

    // Duplicate detection
    const cid = normalized.claim_id as string | undefined;
    if (cid) {
      const prior = seenClaimIds.get(cid);
      if (prior !== undefined) {
        issues.push({ level: 'warning', field: 'claim_id', message: `Duplicate of row ${prior + 1}` });
      } else {
        seenClaimIds.set(cid, idx);
      }
    }

    const status: ValidationLevel = issues.some(i => i.level === 'error')
      ? 'error'
      : issues.some(i => i.level === 'warning') ? 'warning' : 'ok';

    for (const i of issues) {
      const k = i.field ?? '_row';
      issuesByField[k] = (issuesByField[k] ?? 0) + 1;
    }

    parsed.push({ index: idx, raw, normalized, issues, status });
  });

  const ok = parsed.filter(p => p.status === 'ok').length;
  const warning = parsed.filter(p => p.status === 'warning').length;
  const error = parsed.filter(p => p.status === 'error').length;
  const duplicates = parsed.filter(p => p.issues.some(i => i.message.startsWith('Duplicate'))).length;
  const total = parsed.length;
  // Deterministic import score: ok=1.0, warning=0.5, error=0
  const score = total === 0 ? 0 : Math.round(((ok + warning * 0.5) / total) * 100);

  return {
    parsed,
    summary: { total, ok, warning, error, duplicates, import_score: score, issues_by_field: issuesByField },
  };
}
