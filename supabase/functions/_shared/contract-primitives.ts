/**
 * Shared contract-matching primitives used by the worker-dispatcher Edge Function.
 *
 * These are the authoritative server-side definitions.  The frontend mirrors
 * equivalent logic in src/engine/contract-match.ts and
 * src/engine/contract-underpayment.ts.  Any change to matching or pricing
 * logic should be made here first, then kept in sync with those files.
 *
 * reimbursement_method values stored in fee_schedules (database):
 *   fixed_fee | case_rate | per_diem | percent_of_billed | percent_of_medicare
 *
 * Note: the frontend ContractTerms type (src/types/claim.ts) uses a different
 * enum ('fee_schedule' | 'percent_of_billed' | 'per_diem' | 'drg') that
 * reflects the UI/import domain, not the database storage values above.
 */

export type ReimbursementMethod =
  | 'fixed_fee'
  | 'case_rate'
  | 'per_diem'
  | 'percent_of_billed'
  | 'percent_of_medicare';

export interface Contract {
  contract_id: string;
  org_id: string;
  payer_name: string;
  contract_name: string;
  version: string;
  effective_date: string;
  termination_date: string | null;
}

export interface Fee {
  fee_schedule_id: string;
  contract_id: string;
  procedure_code: string;
  modifier: string | null;
  contracted_amount_cents: number;
  reimbursement_method: ReimbursementMethod;
}

export interface ExpectedResult {
  expected: number;
  basis: string;
  conf: number;
}

/**
 * Returns the best-matching active contract for a given payer name and service
 * date.  When multiple contracts match (e.g. renewals), the one with the
 * latest effective_date — and highest version as a tiebreaker — wins.
 */
export function matchContract(
  contracts: Contract[],
  payer_name: string,
  service_date: string,
): Contract | null {
  const wanted = (payer_name ?? '').trim().toLowerCase();
  const candidates = contracts.filter(
    (c) =>
      c.payer_name.trim().toLowerCase() === wanted &&
      service_date >= c.effective_date &&
      (!c.termination_date || service_date <= c.termination_date),
  );
  if (!candidates.length) return null;
  candidates.sort(
    (a, b) =>
      b.effective_date.localeCompare(a.effective_date) ||
      String(b.version).localeCompare(String(a.version)),
  );
  return candidates[0];
}

/**
 * Looks up the fee schedule entry for a procedure code + optional modifier
 * within a contract.  Falls back to the unmodified row, then to the first
 * matching row if no modifier-specific entry exists.
 */
export function findFee(
  fees: Fee[],
  contract_id: string,
  procedure_code: string,
  modifier: string | null,
): Fee | undefined {
  const rows = fees.filter(
    (f) =>
      f.contract_id === contract_id &&
      f.procedure_code.toUpperCase() === procedure_code.toUpperCase(),
  );
  return (
    rows.find((f) => (f.modifier ?? '') === (modifier ?? '')) ??
    rows.find((f) => !f.modifier) ??
    rows[0]
  );
}

/**
 * Computes the expected reimbursement in cents given a fee schedule entry.
 * Returns the expected amount, a human-readable basis string, and a
 * confidence score (0–100).
 *
 * @param fee            - The matched fee schedule row.
 * @param billed_cents   - The billed amount for the procedure line.
 * @param medicare_cents - The Medicare allowable amount (required for
 *                         percent_of_medicare; omit or pass 0 if unavailable).
 */
export function computeExpected(
  fee: Fee,
  billed_cents: number,
  medicare_cents = 0,
): ExpectedResult {
  switch (fee.reimbursement_method) {
    case 'fixed_fee':
    case 'case_rate':
    case 'per_diem':
      return { expected: fee.contracted_amount_cents, basis: fee.reimbursement_method, conf: 95 };

    case 'percent_of_billed': {
      const pct = fee.contracted_amount_cents / 10_000;
      return {
        expected: Math.round(billed_cents * pct),
        basis: `${(pct * 100).toFixed(1)}% of billed`,
        conf: 85,
      };
    }

    case 'percent_of_medicare': {
      if (!medicare_cents) {
        return { expected: 0, basis: 'Medicare allowable unavailable', conf: 30 };
      }
      const pct = fee.contracted_amount_cents / 10_000;
      return {
        expected: Math.round(medicare_cents * pct),
        basis: `${(pct * 100).toFixed(1)}% of Medicare`,
        conf: 80,
      };
    }

    default: {
      // Exhaustiveness guard: if a new ReimbursementMethod value is added to
      // the union without a matching case above, TypeScript will flag this line.
      const _exhaustive: never = fee.reimbursement_method;
      return { expected: fee.contracted_amount_cents, basis: 'Unknown method', conf: 60 };
    }
  }
}

/** Underpayment variance thresholds — must trigger a dispute only if both are exceeded. */
export const VAR_MIN_CENTS = 100; // $1.00
export const VAR_MIN_PCT = 2;     // 2%

/** Maps a variance amount + percentage to a human-readable severity tier. */
export function severityOf(variance_cents: number, variance_pct: number): string {
  if (variance_pct >= 25 || variance_cents >= 50_000) return 'critical';
  if (variance_pct >= 15 || variance_cents >= 20_000) return 'high';
  if (variance_pct >= 5  || variance_cents >=  5_000) return 'medium';
  return 'low';
}

/**
 * Produces a deterministic deduplication key for an underpayment dispute row.
 * Two disputes with the same key are considered identical and the second insert
 * should be skipped.
 */
export function makeDedupeKey(
  claim_id: string,
  contract_id: string | null,
  variance_cents: number,
  service_date: string | null,
): string {
  return `${claim_id}|${contract_id ?? 'none'}|${variance_cents}|${service_date ?? 'none'}`;
}
