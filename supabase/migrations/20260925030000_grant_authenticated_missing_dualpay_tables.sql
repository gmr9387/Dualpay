-- Fixes a live production bug found while building an unrelated RLS
-- integration test: 7 of dualpay's ~40 tables have RLS enabled and a
-- full set of SELECT/INSERT/UPDATE/DELETE policies (org-scoped via
-- is_org_member/has_org_role, same as every other table in the schema)
-- but were NEVER GRANTed to the `authenticated` role at all. RLS
-- policies only ever narrow what a granted role can see/do -- with zero
-- table-level grant, Postgres rejects the query before RLS is even
-- evaluated ("permission denied for table X"), regardless of org
-- membership.
--
-- Confirmed live, not theoretical: `SET ROLE authenticated; SELECT
-- count(*) FROM dualpay.claims;` returns
-- `ERROR: 42501: permission denied for table claims`. This is
-- client-reachable code, not dead paths -- claims, cases, case_events,
-- case_claim_links, adjudication_runs, and traces are all queried
-- directly via supabase.from(...) from src/data/repository.ts, which
-- src/pages/ClaimsWorkbench.tsx and src/pages/Index.tsx import; traces
-- is also queried directly from src/pages/AuditTrace.tsx;
-- member_accumulators from repository.ts as well. Every signed-in
-- user hitting these code paths has been getting a hard permission
-- error since the schema consolidation into this project
-- (qrqekucwdfyqqzomuble) replicated table/policy DDL but not the
-- accompanying GRANT statements for these 7 tables specifically.
--
-- system_config is the one other table missing authenticated grants;
-- left alone deliberately -- confirmed via grep that nothing in
-- src/ ever queries it client-side, so it's genuinely server/
-- admin-only, unlike the 7 below.
grant select, insert, update, delete on dualpay.claims to authenticated;
grant select, insert, update, delete on dualpay.adjudication_runs to authenticated;
grant select, insert, update, delete on dualpay.cases to authenticated;
grant select, insert, update, delete on dualpay.case_events to authenticated;
grant select, insert, update, delete on dualpay.case_claim_links to authenticated;
grant select, insert, update, delete on dualpay.member_accumulators to authenticated;
grant select, insert, update, delete on dualpay.traces to authenticated;
