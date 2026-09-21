/**
 * Marks rows for insert into a table whose org_id column is populated by a
 * BEFORE INSERT trigger (set_default_org_id / set_appeal_recovery_cases_org_id)
 * reading the caller's session-derived org membership — never a client-
 * supplied value or a plain column DEFAULT. Supabase's generated types can't
 * express "trigger-populated", so every such table's Insert type marks
 * org_id required, even though the app must never actually send it (a
 * client-supplied org_id would defeat the point of the trigger). This makes
 * that omission explicit at each call site instead of reaching for a
 * blanket type-erasing cast that would also hide real mistakes in the rest
 * of the row.
 */
export function withTriggerOrgId<T extends object>(rows: T[]): (T & { org_id: string })[] {
  return rows as (T & { org_id: string })[];
}
