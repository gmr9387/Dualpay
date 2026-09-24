-- 1. SECURITY FIX: drop leftover demo policy that allows ANY request (even
--    unauthenticated) to UPDATE any row in dualpay.claim_assignments.
--    qual/with_check are both literal `true`, granted TO public -- a live
--    RLS bypass, not just redundant with claim_assignments_update.
DROP POLICY IF EXISTS claim_assignments_update_demo ON dualpay.claim_assignments;

-- 2. Drop the one confirmed-redundant index: idx_claim_assignments_status
--    (status) is a strict prefix-subset of claim_assignments_status_priority_idx
--    (status, priority DESC), so it adds write overhead with no query benefit.
--    (idx_claim_assignments_assignee was NOT dropped -- it indexes a
--    different column, `assignee`, from claim_assignments_assigned_to_user_id_idx's
--    `assigned_to_user_id`; verified via pg_indexes before assuming duplication.)
DROP INDEX IF EXISTS dualpay.idx_claim_assignments_status;

-- 3. Performance fix: 134 RLS policies across 37 dualpay tables re-evaluate
--    auth.uid()/auth.jwt()/auth.role() once per row instead of once per
--    query (Supabase's #1 flagged RLS perf anti-pattern -- see
--    https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).
--    Driven off the live catalog rather than hand-transcribed to avoid
--    transcription errors across ~130 policies; skips any expression that
--    already contains "(select auth." so it's safe to re-run later if new
--    policies are added without the wrapping.
DO $$
DECLARE
  pol RECORD;
  new_qual text;
  new_check text;
  stmt text;
BEGIN
  FOR pol IN
    SELECT tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'dualpay'
  LOOP
    new_qual := pol.qual;
    new_check := pol.with_check;

    IF pol.qual IS NOT NULL AND pol.qual ~ 'auth\.(uid|jwt|role)\(\)' AND pol.qual !~ '\(select auth\.' THEN
      new_qual := regexp_replace(pol.qual, 'auth\.(uid|jwt|role)\(\)', '(select auth.\1())', 'g');
    END IF;

    IF pol.with_check IS NOT NULL AND pol.with_check ~ 'auth\.(uid|jwt|role)\(\)' AND pol.with_check !~ '\(select auth\.' THEN
      new_check := regexp_replace(pol.with_check, 'auth\.(uid|jwt|role)\(\)', '(select auth.\1())', 'g');
    END IF;

    IF new_qual IS NOT DISTINCT FROM pol.qual AND new_check IS NOT DISTINCT FROM pol.with_check THEN
      CONTINUE;
    END IF;

    stmt := format('ALTER POLICY %I ON dualpay.%I', pol.policyname, pol.tablename);
    IF pol.qual IS NOT NULL THEN
      stmt := stmt || format(' USING (%s)', new_qual);
    END IF;
    IF pol.with_check IS NOT NULL THEN
      stmt := stmt || format(' WITH CHECK (%s)', new_check);
    END IF;

    EXECUTE stmt;
  END LOOP;
END $$;
