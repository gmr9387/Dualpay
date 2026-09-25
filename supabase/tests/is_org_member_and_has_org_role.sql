-- =============================================================================
-- Integration test: dualpay.is_org_member() / dualpay.has_org_role()
-- =============================================================================
-- Closes the gap named in docs/RISK_REGISTER.md and
-- valtaris-nucleus's docs/adr/003-security-definer-choke-point.md: these
-- two SECURITY DEFINER functions are the single enforcement choke point
-- nearly every RLS policy in this schema calls, but they had never been
-- verified against real inserted rows and real RLS policy evaluation --
-- only against the boolean predicate in isolation.
--
-- An earlier attempt at this (same session) tried to clean up by deleting
-- the test organization afterward, which cascaded into ops_events and hit
-- the append-only prevent_ops_events_update_delete/prevent_ops_events_delete
-- triggers. This version never issues a DELETE at all: everything happens
-- inside one transaction that ends in ROLLBACK, so there is nothing to
-- clean up and nothing to fight the audit-trail triggers.
--
-- Unlike supabase/tests/rls_security_verification.sql (pgTAP, marked
-- STATUS: PENDING -- pgTAP is not installed on this project, confirmed via
-- `SELECT * FROM pg_extension`, and it references public.organizations /
-- public.organization_members, which predate the schema-consolidation move
-- to `dualpay.*`), this file has NO pgTAP dependency and has actually been
-- run against the live project (qrqekucwdfyqqzomuble) in this session, not
-- just written. All 9 assertions passed; the transaction was then rolled
-- back and a follow-up query confirmed zero residual rows.
--
-- HOW TO RUN
-- ----------
--   Via the Supabase SQL editor / MCP execute_sql tool: paste this file's
--   body as-is (it is already a complete BEGIN...ROLLBACK block).
--   Via psql: psql "<connection string>" -f supabase/tests/is_org_member_and_has_org_role.sql
--
-- A failing assertion raises an exception naming which check failed and
-- what it expected vs. got, then the transaction still rolls back (the
-- exception itself aborts it) -- there is no path that leaves test rows
-- behind, pass or fail.
-- =============================================================================

BEGIN;

create temp table rls_test_results (check_name text, expected boolean, actual boolean);

-- Synthetic, obviously-fake identifiers (99999999-... prefix) so a stray
-- run against a real database is unmistakably a test artifact, not
-- confusable with a real org/user id.
insert into dualpay.organizations (org_id, name) values
  ('99999999-9999-9999-9999-999999999901', 'RLS Integration Test Org (rolled back, never committed)');

insert into dualpay.organization_members (org_id, user_id, role, expires_at) values
  -- active_admin: real member, no expiry
  ('99999999-9999-9999-9999-999999999901', '99999999-9999-9999-9999-999999999911', 'admin', null),
  -- expired_viewer: was a real member, membership expired yesterday
  ('99999999-9999-9999-9999-999999999901', '99999999-9999-9999-9999-999999999912', 'viewer', now() - interval '1 day');
-- 99999999-9999-9999-9999-999999999913 (outsider) is deliberately never inserted.

insert into dualpay.claims (claim_id, member_id, service_date_from, status, payload, org_id) values
  ('rls-test-claim-1', 'rls-test-member-1', current_date, 'submitted', '{}'::jsonb, '99999999-9999-9999-9999-999999999901');

insert into dualpay.adjudication_runs (run_id, claim_id, org_id, payload) values
  ('rls-test-run-1', 'rls-test-claim-1', '99999999-9999-9999-9999-999999999901', '{}'::jsonb);

-- Function-level assertions: call is_org_member/has_org_role directly,
-- as the privileged setup role (RLS not yet in play here).
insert into rls_test_results values
  ('fn: active member is_org_member = true', true,
    dualpay.is_org_member('99999999-9999-9999-9999-999999999901','99999999-9999-9999-9999-999999999911')),
  ('fn: expired member is_org_member = false (expiry check)', false,
    dualpay.is_org_member('99999999-9999-9999-9999-999999999901','99999999-9999-9999-9999-999999999912')),
  ('fn: outsider is_org_member = false', false,
    dualpay.is_org_member('99999999-9999-9999-9999-999999999901','99999999-9999-9999-9999-999999999913')),
  ('fn: active has_org_role([admin]) = true', true,
    dualpay.has_org_role('99999999-9999-9999-9999-999999999901','99999999-9999-9999-9999-999999999911', array['admin'])),
  ('fn: active has_org_role([analyst]) = false (role not in array)', false,
    dualpay.has_org_role('99999999-9999-9999-9999-999999999901','99999999-9999-9999-9999-999999999911', array['analyst'])),
  ('fn: expired has_org_role([viewer,admin]) = false (expiry overrides role match)', false,
    dualpay.has_org_role('99999999-9999-9999-9999-999999999901','99999999-9999-9999-9999-999999999912', array['viewer','admin']));

-- RLS-level assertions: real policy enforcement via a real RLS-protected
-- table (adjudication_runs), impersonating each user by switching to the
-- `authenticated` role and setting the same GUC PostgREST sets from a real
-- JWT (auth.uid() reads request.jwt.claim.sub -- see auth.uid()'s own
-- definition). This is what makes this a genuine integration test rather
-- than another function-only check: it proves the policy, not just the
-- predicate behind it.
grant all on rls_test_results to authenticated;
set local role authenticated;

set local "request.jwt.claim.sub" = '99999999-9999-9999-9999-999999999911';
insert into rls_test_results values
  ('RLS(active admin): SELECT adjudication_runs sees the 1 org row', true,
    (select count(*) = 1 from dualpay.adjudication_runs where org_id = '99999999-9999-9999-9999-999999999901'));

set local "request.jwt.claim.sub" = '99999999-9999-9999-9999-999999999912';
insert into rls_test_results values
  ('RLS(expired viewer): SELECT adjudication_runs sees 0 rows', true,
    (select count(*) = 0 from dualpay.adjudication_runs where org_id = '99999999-9999-9999-9999-999999999901'));

set local "request.jwt.claim.sub" = '99999999-9999-9999-9999-999999999913';
insert into rls_test_results values
  ('RLS(outsider): SELECT adjudication_runs sees 0 rows', true,
    (select count(*) = 0 from dualpay.adjudication_runs where org_id = '99999999-9999-9999-9999-999999999901'));

reset role;

-- Fail loudly and specifically if anything regressed.
do $$
declare
  r record;
  failures text := '';
begin
  for r in select check_name, expected, actual from rls_test_results where expected is distinct from actual loop
    failures := failures || format(E'\n  - %s (expected %s, got %s)', r.check_name, r.expected, r.actual);
  end loop;

  if failures <> '' then
    raise exception 'is_org_member/has_org_role integration test FAILED:%', failures;
  end if;

  raise notice 'is_org_member/has_org_role integration test: all % checks passed', (select count(*) from rls_test_results);
end $$;

ROLLBACK;
