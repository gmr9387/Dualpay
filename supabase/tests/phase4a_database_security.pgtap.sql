-- pgTAP tests: database-level security (RLS, SECURITY DEFINER hardening,
-- storage isolation, audit immutability, role-based authorization)
--
-- STATUS: fixed and actually run against the live project
-- (qrqekucwdfyqqzomuble) -- see docs/RISK_REGISTER.md risk #102. This
-- file went through the most drift of the three test files fixed in
-- that pass:
--
--   - public.* -> dualpay.* (schema consolidation --
--     docs/adr/001-single-supabase-project.md, valtaris-nucleus repo).
--     Section "SECURITY DEFINER hardening" specifically needed its
--     search_path assertion updated too: every dualpay SECURITY
--     DEFINER function pins `search_path=dualpay`, not
--     `search_path=public` -- confirmed against all 15 of them live,
--     this is a real, consistently-held property, not a guess.
--   - RLS-enablement and RLS-policy-existence checks (pg_class /
--     pg_policies) now filter `schemaname/nspname = 'dualpay'`
--     explicitly. valtaris-nucleus's own `public` schema, in this same
--     project, has tables of the exact same names (`claims`,
--     `organizations`, `ops_events`, etc. -- see its gapMap.md item 21,
--     all confirmed empty/unused). An unqualified lookup would
--     silently match either schema.
--   - A genuine bug in the SQL itself, not just schema drift: six
--     assertions passed a data-modifying WITH ... UPDATE/DELETE/INSERT
--     ... RETURNING CTE as an argument to is()/throws_ok(). Postgres
--     rejects that outright ("WITH clause containing a data-modifying
--     statement must be at the top level") -- these assertions could
--     never have run as originally written, in any environment, ever.
--     Fixed by promoting each CTE to the top level of its own
--     statement (`WITH x AS (...) INSERT INTO pgtap_out SELECT
--     is(...)`), which is what Postgres requires.
--   - Two assertions encoded the wrong expected *shape* of denial, not
--     just the wrong schema: "Anonymous role cannot access private
--     storage objects" and "Analyst cannot delete recovery outcomes"
--     both used throws_ok(..., '42501', ...), expecting a hard
--     permission error. Verified live: both actually return 0 rows
--     silently (correct RLS filtering, not a data leak) -- same
--     mechanism as the claims cross-org tests earlier in this same
--     file, which correctly used is(count, 0). Updated to match.
--     Conversely, "ordinary authenticated role cannot UPDATE/DELETE
--     ops_events" needed the opposite fix: authenticated has literally
--     no UPDATE/DELETE grant on ops_events at the table level (a
--     harder denial than RLS), so these now use throws_ok instead of
--     the WITH/is(count) pattern.
--   - A REAL, separate bug this file's own "Admin can perform
--     organization administration (member add)" assertion caught:
--     dualpay.organization_members' own INSERT policy
--     (members_insert_bootstrap_or_admin) threw
--     "infinite recursion detected in policy for relation
--     organization_members" (42P17) on every insert, admin or not --
--     reproduced with a 4-line repro independent of this test file.
--     Root cause: the policy's own WITH CHECK ran a raw, non-privileged
--     subquery directly against organization_members (the
--     bootstrap-check "is this the first member of a brand-new org"),
--     which re-triggers RLS on the same table it's attached to -- the
--     classic Postgres self-reference trap. Fixed in a migration
--     (`fix_organization_members_insert_recursion`), the same
--     SECURITY-DEFINER-choke-point pattern is_org_member/has_org_role
--     already establish (docs/adr/003-security-definer-choke-point.md):
--     a new `dualpay.org_has_no_members(org_id)` function does that
--     check with elevated privilege instead. Verified live afterward:
--     admin insert succeeds, non-admin insert into a non-empty org is
--     still correctly denied, and the legitimate bootstrap
--     self-insert-into-a-brand-new-org path still works. This bug was
--     NOT reachable through the live app -- AdminConsole.tsx's member
--     management exclusively calls the invite-member Edge Function
--     (service role, bypasses RLS) -- but it was a real landmine for
--     any future direct-insert code path, not a hypothetical one.
--
-- All 37 assertions pass; a follow-up query after ROLLBACK confirmed
-- zero residual rows in every table this file touches.
--
-- EXECUTION
-- ---------
--   Via the Supabase SQL editor / MCP execute_sql tool: paste this
--   file's body as-is.
--   Via psql: psql "<connection string>" -f supabase/tests/phase4a_database_security.pgtap.sql

BEGIN;
SELECT no_plan();

CREATE TEMP TABLE pgtap_out (line text);
GRANT ALL ON pgtap_out TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Fixtures (real rows, real roles, real RLS execution)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  INSERT INTO dualpay.organizations (org_id, name)
  VALUES
    ('11111111-1111-1111-1111-111111111111', 'Phase4A Org A'),
    ('22222222-2222-2222-2222-222222222222', 'Phase4A Org B')
  ON CONFLICT (org_id) DO NOTHING;

  INSERT INTO dualpay.organization_members (org_id, user_id, role)
  VALUES
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner'),
    ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'viewer'),
    ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'analyst'),
    ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'admin'),
    ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'manager'),
    ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'owner')
  ON CONFLICT (org_id, user_id) DO NOTHING;

  INSERT INTO dualpay.claims (
    claim_id, member_id, provider_name, service_date_from, status, total_billed_cents, payload, org_id
  ) VALUES
    ('phase4a-claim-a', 'member-a', 'Provider A', DATE '2026-01-01', 'open', 1000, '{}'::jsonb, '11111111-1111-1111-1111-111111111111'),
    ('phase4a-claim-b', 'member-b', 'Provider B', DATE '2026-01-02', 'open', 2000, '{}'::jsonb, '22222222-2222-2222-2222-222222222222')
  ON CONFLICT (claim_id) DO NOTHING;

  INSERT INTO dualpay.cases (case_id, member_id, status, description, tags, org_id)
  VALUES
    ('phase4a-case-a', 'member-a', 'OPEN', 'case A', '{}'::text[], '11111111-1111-1111-1111-111111111111')
  ON CONFLICT (case_id) DO NOTHING;

  INSERT INTO dualpay.ops_events (
    event_id, kind, summary, payload, actor, actor_user_id, org_id
  ) VALUES (
    'phase4a-audit-event', 'phase4a_seed', 'Phase4A seed audit event', '{}'::jsonb, 'seed', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'
  ) ON CONFLICT (event_id) DO NOTHING;
END
$$;

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('evidence-documents', 'evidence-documents', false),
  ('appeal-packets', 'appeal-packets', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.objects (id, bucket_id, name, owner)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'evidence-documents', '11111111-1111-1111-1111-111111111111/phase4a-a.txt', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('00000000-0000-0000-0000-0000000000b1', 'evidence-documents', '22222222-2222-2222-2222-222222222222/phase4a-b.txt', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- RLS enablement checks
-- -----------------------------------------------------------------------------

INSERT INTO pgtap_out SELECT ok((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dualpay' AND c.relname='claims'), 'claims has RLS enabled');
INSERT INTO pgtap_out SELECT ok((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dualpay' AND c.relname='organization_members'), 'organization_members has RLS enabled');
INSERT INTO pgtap_out SELECT ok((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dualpay' AND c.relname='ops_events'), 'ops_events has RLS enabled');
INSERT INTO pgtap_out SELECT ok((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dualpay' AND c.relname='evidence_documents'), 'evidence_documents has RLS enabled');
INSERT INTO pgtap_out SELECT ok((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dualpay' AND c.relname='appeal_recovery_cases'), 'appeal_recovery_cases has RLS enabled');
INSERT INTO pgtap_out SELECT ok((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dualpay' AND c.relname='underpayment_disputes'), 'underpayment_disputes has RLS enabled');
INSERT INTO pgtap_out SELECT ok((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dualpay' AND c.relname='recovery_outcomes'), 'recovery_outcomes has RLS enabled');
INSERT INTO pgtap_out SELECT ok((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dualpay' AND c.relname='system_config'), 'system_config has RLS enabled');

-- -----------------------------------------------------------------------------
-- Tenant isolation + anonymous access
-- -----------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

INSERT INTO pgtap_out SELECT is((SELECT count(*)::int FROM dualpay.claims WHERE claim_id = 'phase4a-claim-b'), 0, 'Org A cannot SELECT Org B claims');

WITH upd AS (UPDATE dualpay.claims SET status='denied' WHERE claim_id='phase4a-claim-b' RETURNING 1)
INSERT INTO pgtap_out SELECT is((SELECT count(*)::int FROM upd), 0, 'Org A cannot UPDATE Org B claims');

WITH del AS (DELETE FROM dualpay.claims WHERE claim_id='phase4a-claim-b' RETURNING 1)
INSERT INTO pgtap_out SELECT is((SELECT count(*)::int FROM del), 0, 'Org A cannot DELETE Org B claims');

INSERT INTO pgtap_out SELECT throws_ok(
  $$INSERT INTO dualpay.claims (claim_id, member_id, provider_name, service_date_from, status, total_billed_cents, payload, org_id)
    VALUES ('phase4a-cross-org-insert', 'member-x', 'Provider X', DATE '2026-01-03', 'open', 3000, '{}'::jsonb, '22222222-2222-2222-2222-222222222222')$$,
  '42501', NULL, 'Org A cannot INSERT into Org B tenant scope');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);

INSERT INTO pgtap_out SELECT throws_ok($$SELECT claim_id FROM dualpay.claims LIMIT 1$$, '42501', NULL, 'Anonymous role cannot read protected claims table');

RESET ROLE;

-- -----------------------------------------------------------------------------
-- SECURITY DEFINER hardening and authorization
-- -----------------------------------------------------------------------------

INSERT INTO pgtap_out SELECT is(
  (
    SELECT count(*)::int
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'dualpay'
      AND p.prosecdef
      AND (
        p.proconfig IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg = 'search_path=dualpay'
        )
      )
  ),
  0,
  'All dualpay SECURITY DEFINER functions pin search_path=dualpay'
);

INSERT INTO pgtap_out SELECT ok(
  has_function_privilege('authenticated', 'dualpay.claim_next_queue_job(text)', 'EXECUTE') = false,
  'Authenticated role lacks EXECUTE on claim_next_queue_job'
);

INSERT INTO pgtap_out SELECT ok(
  has_function_privilege('service_role', 'dualpay.claim_next_queue_job(text)', 'EXECUTE'),
  'Service role has EXECUTE on claim_next_queue_job'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

INSERT INTO pgtap_out SELECT throws_ok($$SELECT dualpay.claim_next_queue_job('phase4a-worker')$$, '42501', NULL, 'Unauthorized role cannot invoke privileged queue-claim SECURITY DEFINER function');

RESET ROLE;
SET LOCAL ROLE service_role;

INSERT INTO pgtap_out SELECT lives_ok($$SELECT dualpay.claim_next_queue_job('phase4a-worker-service')$$, 'Service role can invoke claim_next_queue_job');

RESET ROLE;

-- -----------------------------------------------------------------------------
-- Storage isolation
-- -----------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

INSERT INTO pgtap_out SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE bucket_id='evidence-documents' AND name LIKE '22222222-2222-2222-2222-222222222222/%'),
  0, 'Org A cannot read Org B evidence bucket objects');

INSERT INTO pgtap_out SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE bucket_id='evidence-documents' AND name LIKE '11111111-1111-1111-1111-111111111111/%'),
  1, 'Org A can read own evidence bucket objects');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);

INSERT INTO pgtap_out SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id='evidence-documents'), 0, 'Anonymous role sees zero private storage objects (RLS-filtered, not a leak)');

RESET ROLE;

-- -----------------------------------------------------------------------------
-- Audit immutability (ops_events append-only)
-- -----------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

INSERT INTO pgtap_out SELECT throws_ok($$UPDATE dualpay.ops_events SET summary='tamper-attempt' WHERE event_id='phase4a-audit-event'$$, NULL, NULL, 'Ordinary authenticated role cannot UPDATE ops_events rows (no table grant)');
INSERT INTO pgtap_out SELECT throws_ok($$DELETE FROM dualpay.ops_events WHERE event_id='phase4a-audit-event'$$, NULL, NULL, 'Ordinary authenticated role cannot DELETE ops_events rows (no table grant)');

RESET ROLE;
SET LOCAL ROLE service_role;

INSERT INTO pgtap_out SELECT throws_ok($$UPDATE dualpay.ops_events SET summary='service-role-tamper' WHERE event_id='phase4a-audit-event'$$, 'P0001', NULL, 'Append-only trigger blocks UPDATE even for privileged role');
INSERT INTO pgtap_out SELECT throws_ok($$DELETE FROM dualpay.ops_events WHERE event_id='phase4a-audit-event'$$, 'P0001', NULL, 'Append-only trigger blocks DELETE even for privileged role');

RESET ROLE;

-- -----------------------------------------------------------------------------
-- Privileged operations (current authorization behavior)
-- -----------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true); -- viewer

INSERT INTO pgtap_out SELECT throws_ok(
  $$INSERT INTO dualpay.idempotency_keys (key, claim_id, org_id, actor) VALUES ('phase4a-key-viewer', 'phase4a-claim-a', '11111111-1111-1111-1111-111111111111', 'viewer-test')$$,
  '42501', NULL, 'Viewer cannot perform payment/idempotency write operation');

INSERT INTO pgtap_out SELECT throws_ok(
  $$INSERT INTO dualpay.recovery_outcomes (outcome_id, claim_id, denial_id, payer_id, resolution_type, resolution_date, denied_amount_cents, recovered_amount_cents, unrecovered_amount_cents, notes, payload, org_id)
    VALUES ('phase4a-outcome-viewer', 'phase4a-claim-a', NULL, NULL, 'written_off', now(), 1000, 0, 1000, 'viewer attempt', '{}'::jsonb, '11111111-1111-1111-1111-111111111111')$$,
  '42501', NULL, 'Viewer cannot create recovery/write-off outcome');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', true); -- analyst

-- Phase 4B Remediation D: INSERT on idempotency_keys is revoked from authenticated.
-- All idempotency writes must go through the four SECURITY DEFINER RPCs.
INSERT INTO pgtap_out SELECT throws_ok(
  $$INSERT INTO dualpay.idempotency_keys (key, claim_id, org_id, actor) VALUES ('phase4a-key-analyst', 'phase4a-claim-a', '11111111-1111-1111-1111-111111111111', 'analyst-test')$$,
  '42501', NULL, 'Analyst cannot directly INSERT into idempotency_keys -- must use Phase 4B SECURITY DEFINER RPCs');

INSERT INTO pgtap_out SELECT lives_ok(
  $$INSERT INTO dualpay.recovery_outcomes (outcome_id, claim_id, denial_id, payer_id, resolution_type, resolution_date, denied_amount_cents, recovered_amount_cents, unrecovered_amount_cents, notes, payload, org_id)
    VALUES ('phase4a-outcome-analyst', 'phase4a-claim-a', NULL, NULL, 'written_off', now(), 1000, 0, 1000, 'analyst write-off', '{}'::jsonb, '11111111-1111-1111-1111-111111111111')$$,
  'Analyst can create recovery/write-off outcome');

WITH del AS (DELETE FROM dualpay.recovery_outcomes WHERE outcome_id='phase4a-outcome-analyst' RETURNING 1)
INSERT INTO pgtap_out SELECT is((SELECT count(*)::int FROM del), 0, 'Analyst cannot delete recovery outcomes (RLS-filtered, not a leak)');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true); -- admin

INSERT INTO pgtap_out SELECT lives_ok(
  $$INSERT INTO dualpay.organization_members (org_id, user_id, role) VALUES ('11111111-1111-1111-1111-111111111111', 'abababab-abab-abab-abab-abababababab', 'viewer')$$,
  'Admin can perform organization administration (member add)');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', true); -- manager

INSERT INTO pgtap_out SELECT throws_ok(
  $$INSERT INTO dualpay.organization_members (org_id, user_id, role) VALUES ('11111111-1111-1111-1111-111111111111', 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd', 'viewer')$$,
  '42501', NULL, 'Manager cannot perform organization administration member add');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

INSERT INTO pgtap_out SELECT throws_ok($$SELECT key FROM dualpay.system_config LIMIT 1$$, '42501', NULL, 'Authenticated users cannot read security configuration table');

RESET ROLE;
SET LOCAL ROLE service_role;

INSERT INTO pgtap_out SELECT lives_ok($$SELECT key FROM dualpay.system_config LIMIT 1$$, 'Service role can read security configuration table');

RESET ROLE;

-- -----------------------------------------------------------------------------
-- Additional RLS authorized behavior checks (positive path)
-- -----------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

INSERT INTO pgtap_out SELECT is((SELECT count(*)::int FROM dualpay.claims WHERE claim_id = 'phase4a-claim-a'), 1, 'Authorized tenant can SELECT own claim');

WITH upd AS (UPDATE dualpay.claims SET status='in_progress' WHERE claim_id='phase4a-claim-a' RETURNING 1)
INSERT INTO pgtap_out SELECT is((SELECT count(*)::int FROM upd), 1, 'Authorized tenant can UPDATE own claim');

WITH ins AS (
  INSERT INTO dualpay.case_events (
    event_id, case_id, claim_id, event_type, description, metadata, occurred_at, org_id
  ) VALUES (
    'phase4a-case-event-a',
    'phase4a-case-a',
    'phase4a-claim-a',
    'note_added',
    'tenant-owned case action',
    '{}'::jsonb,
    now(),
    '11111111-1111-1111-1111-111111111111'
  )
  ON CONFLICT (event_id) DO NOTHING
  RETURNING 1
)
INSERT INTO pgtap_out SELECT is((SELECT count(*)::int FROM ins), 1, 'Authorized tenant can INSERT case action event in own org');

RESET ROLE;

-- No DELETE cleanup here on purpose -- the whole file rolls back, and
-- ops_events specifically has the append-only trigger that would fight
-- any attempted cleanup delete (see rls_security_verification.sql's
-- header for the full explanation of why this file never tries).
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE line LIKE 'not ok%') AS failed,
  array_agg(line) FILTER (WHERE line LIKE 'not ok%') AS failure_lines
FROM pgtap_out;

ROLLBACK;
