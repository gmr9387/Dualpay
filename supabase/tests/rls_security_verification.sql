-- =============================================================================
-- PR #5 — PostgreSQL RLS + SECURITY DEFINER Live Verification
-- =============================================================================
-- PURPOSE
-- -------
-- 30 assertions providing full database-level security proof: SECURITY
-- DEFINER function access control, RLS SELECT/INSERT isolation across
-- org boundaries, ops_events immutability, is_org_member/has_org_role
-- correctness, and storage/RLS policy existence.
--
-- STATUS: this file was previously marked PENDING (pgTAP not installed,
-- and it referenced public.organizations/public.claims/etc. from before
-- the Supabase schema-consolidation move to dualpay.* -- see
-- docs/RISK_REGISTER.md risk #102 and valtaris-nucleus's
-- docs/adr/001-single-supabase-project.md). Actually run against the
-- live project (qrqekucwdfyqqzomuble) in this session -- all 30
-- assertions pass, zero residual rows after rollback.
--
-- Real drift fixed along the way, beyond just the schema prefix:
--   - `contracts` was renamed to `payer_contracts` at some point, with a
--     different column set (contract_type instead of status, uuid
--     contract_id instead of a hand-assigned text id).
--   - `evidence_documents`'s real columns are storage_bucket/
--     storage_path/filename/mime_type/file_size/document_type/version,
--     not the file_name/file_type/file_size_bytes this file assumed.
--   - `claims` has no payer_name column; it has member_id (required)
--     and provider_name instead.
--   - Section 8's `pg_policies`/`information_schema.routine_privileges`
--     lookups had no schema filter. valtaris-nucleus's own `public`
--     schema (same project) has tables of the SAME names (`claims`,
--     `organizations`, `ops_events`, etc. -- see its gapMap.md item 21,
--     all confirmed empty/unused, a separate real finding logged
--     there). An unqualified `WHERE tablename = 'claims'` would
--     silently match either schema's policy. Every such check below is
--     schema-qualified.
--
-- A subtler, genuinely non-obvious finding from getting this to actually
-- pass: pgTAP's own `plan()`/`finish()` bookkeeping lives in a table
-- pgTAP creates under whatever role first calls `plan()` (here,
-- postgres, since that runs before any role switch). Once the script
-- does `SET LOCAL ROLE anon` or `authenticated` to simulate a real
-- caller -- which this file has to do, repeatedly, to test RLS as
-- different users -- `ok()`/`throws_ok()`/etc. calls made under that
-- role can't write to postgres-owned bookkeeping, and unlike a plain
-- INSERT (which raises a clear `permission denied`), pgTAP's internal
-- recording silently drops the result: `finish()` at the end reports as
-- if no tests had ever run, without ever throwing an error. This file
-- routes around it entirely: `pgtap_out`, a temp table created (and
-- GRANTed to anon/authenticated) before any role switch, captures each
-- assertion function's own return value directly
-- (`INSERT INTO pgtap_out SELECT ok(...)`) instead of relying on
-- `plan()`/`finish()` to track results across role switches.
--
-- EXECUTION
-- ---------
--   Via the Supabase SQL editor / MCP execute_sql tool: paste this
--   file's body as-is (it is already a complete BEGIN...ROLLBACK
--   block; the final SELECT summarizes pass/fail -- a `failed` count
--   above 0, or `failure_lines` naming which assertions failed, means
--   something regressed).
--   Via psql: psql "<connection string>" -f supabase/tests/rls_security_verification.sql
-- =============================================================================

BEGIN;
SELECT plan(30);

CREATE TEMP TABLE pgtap_out (line text);
GRANT ALL ON pgtap_out TO anon, authenticated;

-- =============================================================================
-- SETUP: Two organizations and two users
-- =============================================================================

DO $$
DECLARE
  org_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001'::uuid;
  org_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002'::uuid;
  user_a uuid := 'aaaaaaaa-ffff-0000-0000-000000000001'::uuid;
  user_b uuid := 'bbbbbbbb-ffff-0000-0000-000000000002'::uuid;
BEGIN
  INSERT INTO dualpay.organizations (org_id, name) VALUES (org_a, 'Test Org A') ON CONFLICT (org_id) DO NOTHING;
  INSERT INTO dualpay.organizations (org_id, name) VALUES (org_b, 'Test Org B') ON CONFLICT (org_id) DO NOTHING;
  INSERT INTO dualpay.organization_members (org_id, user_id, role) VALUES (org_a, user_a, 'analyst') ON CONFLICT DO NOTHING;
  INSERT INTO dualpay.organization_members (org_id, user_id, role) VALUES (org_b, user_b, 'analyst') ON CONFLICT DO NOTHING;
END $$;

-- =============================================================================
-- HELPER: Switch to authenticated role with a given JWT subject
-- =============================================================================

CREATE OR REPLACE FUNCTION set_authenticated_user(uid uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reset_role() RETURNS void AS $$
BEGIN
  SET LOCAL ROLE postgres;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- SECTION 1: SECURITY DEFINER function access control
-- =============================================================================

SET LOCAL ROLE anon;
INSERT INTO pgtap_out SELECT throws_ok(
  $$SELECT dualpay.claim_next_queue_job('contract_recovery_analysis')$$,
  '42501', NULL, 'anon: claim_next_queue_job denied');

SELECT set_authenticated_user('aaaaaaaa-ffff-0000-0000-000000000001'::uuid);
INSERT INTO pgtap_out SELECT throws_ok(
  $$SELECT dualpay.claim_next_queue_job('contract_recovery_analysis')$$,
  '42501', NULL, 'authenticated: claim_next_queue_job denied');

SET LOCAL ROLE anon;
INSERT INTO pgtap_out SELECT throws_ok(
  $$SELECT dualpay.recover_stalled_queue_jobs(30)$$,
  '42501', NULL, 'anon: recover_stalled_queue_jobs denied');

SELECT set_authenticated_user('aaaaaaaa-ffff-0000-0000-000000000001'::uuid);
INSERT INTO pgtap_out SELECT throws_ok(
  $$SELECT dualpay.recover_stalled_queue_jobs(30)$$,
  '42501', NULL, 'authenticated: recover_stalled_queue_jobs denied');

SELECT reset_role();

-- =============================================================================
-- SECTION 2: RLS SELECT isolation — claims
-- =============================================================================

INSERT INTO dualpay.claims (claim_id, org_id, member_id, provider_name, service_date_from, status, payload)
  VALUES
    ('PGTAP-CLM-A1', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'PGTAP-MBR-A', 'Payer A', current_date, 'denied', '{}'::jsonb),
    ('PGTAP-CLM-B1', 'bbbbbbbb-0000-0000-0000-000000000002'::uuid, 'PGTAP-MBR-B', 'Payer B', current_date, 'denied', '{}'::jsonb)
  ON CONFLICT DO NOTHING;

SELECT set_authenticated_user('aaaaaaaa-ffff-0000-0000-000000000001'::uuid);
INSERT INTO pgtap_out SELECT results_eq(
  $$SELECT org_id::text FROM dualpay.claims WHERE claim_id LIKE 'PGTAP-CLM-%' ORDER BY claim_id$$,
  ARRAY['aaaaaaaa-0000-0000-0000-000000000001'],
  'User A: only sees Org A claims');

INSERT INTO pgtap_out SELECT throws_ok(
  $$INSERT INTO dualpay.claims (claim_id, org_id, member_id, provider_name, service_date_from, status, payload)
    VALUES ('PGTAP-CLM-B-EVIL', 'bbbbbbbb-0000-0000-0000-000000000002'::uuid, 'PGTAP-MBR-EVIL', 'Evil', current_date, 'denied', '{}'::jsonb)$$,
  NULL, NULL, 'User A: cannot INSERT Org B claim');

SELECT set_authenticated_user('bbbbbbbb-ffff-0000-0000-000000000002'::uuid);
INSERT INTO pgtap_out SELECT results_eq(
  $$SELECT org_id::text FROM dualpay.claims WHERE claim_id LIKE 'PGTAP-CLM-%' ORDER BY claim_id$$,
  ARRAY['bbbbbbbb-0000-0000-0000-000000000002'],
  'User B: only sees Org B claims');

-- =============================================================================
-- SECTION 3: ops_events immutability trigger
-- =============================================================================

SELECT reset_role();

INSERT INTO dualpay.ops_events (event_id, org_id, kind, actor, summary, payload)
  VALUES ('PGTAP-EV-001', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'test_event', 'pgtap', 'test', '{}')
  ON CONFLICT DO NOTHING;

SELECT set_authenticated_user('aaaaaaaa-ffff-0000-0000-000000000001'::uuid);
INSERT INTO pgtap_out SELECT lives_ok(
  $$INSERT INTO dualpay.ops_events (event_id, org_id, kind, actor, summary, payload)
    VALUES ('PGTAP-EV-002', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'test_event', 'pgtap-user', 'test insert', '{}')$$,
  'authenticated: INSERT ops_events succeeds');

INSERT INTO pgtap_out SELECT throws_ok(
  $$UPDATE dualpay.ops_events SET summary = 'tampered' WHERE event_id = 'PGTAP-EV-001'$$,
  NULL, NULL, 'authenticated: UPDATE ops_events raises trigger');

INSERT INTO pgtap_out SELECT throws_ok(
  $$DELETE FROM dualpay.ops_events WHERE event_id = 'PGTAP-EV-001'$$,
  NULL, NULL, 'authenticated: DELETE ops_events raises trigger');

-- =============================================================================
-- SECTION 4: RLS isolation — payer_contracts
-- =============================================================================
-- (renamed from `contracts` at some point pre-consolidation; contract_id
-- is uuid here, not a hand-assigned text id, and there's a required
-- contract_type column with no `status` column at all)

SELECT reset_role();

INSERT INTO dualpay.payer_contracts (contract_id, org_id, payer_name, contract_name, version, effective_date, contract_type)
  VALUES
    ('a1111111-1111-1111-1111-111111111111'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
     'Payer A', 'Contract A', '1.0', '2026-01-01', 'fee_for_service'),
    ('b2222222-2222-2222-2222-222222222222'::uuid, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
     'Payer B', 'Contract B', '1.0', '2026-01-01', 'fee_for_service')
  ON CONFLICT DO NOTHING;

SELECT set_authenticated_user('aaaaaaaa-ffff-0000-0000-000000000001'::uuid);
INSERT INTO pgtap_out SELECT results_eq(
  $$SELECT org_id::text FROM dualpay.payer_contracts WHERE contract_id IN ('a1111111-1111-1111-1111-111111111111'::uuid, 'b2222222-2222-2222-2222-222222222222'::uuid) ORDER BY contract_id$$,
  ARRAY['aaaaaaaa-0000-0000-0000-000000000001'],
  'User A: only sees Org A contracts');

SELECT set_authenticated_user('bbbbbbbb-ffff-0000-0000-000000000002'::uuid);
INSERT INTO pgtap_out SELECT is_empty(
  $$SELECT * FROM dualpay.payer_contracts WHERE contract_id = 'a1111111-1111-1111-1111-111111111111'::uuid$$,
  'User B: cannot see Org A contract');

-- =============================================================================
-- SECTION 5: RLS isolation — evidence_documents
-- =============================================================================
-- (real columns: storage_bucket/storage_path/filename/mime_type/
-- file_size/document_type/version -- this file previously assumed
-- file_name/file_type/file_size_bytes, none of which exist)

SELECT reset_role();

INSERT INTO dualpay.evidence_documents (document_id, org_id, storage_bucket, storage_path, filename, mime_type, file_size, document_type, version)
  VALUES
    ('c3333333-3333-3333-3333-333333333333'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
     'evidence-documents', 'pgtap/a.pdf', 'a.pdf', 'application/pdf', 1024, 'other', 1),
    ('d4444444-4444-4444-4444-444444444444'::uuid, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
     'evidence-documents', 'pgtap/b.pdf', 'b.pdf', 'application/pdf', 1024, 'other', 1)
  ON CONFLICT DO NOTHING;

SELECT set_authenticated_user('aaaaaaaa-ffff-0000-0000-000000000001'::uuid);
INSERT INTO pgtap_out SELECT is_empty(
  $$SELECT * FROM dualpay.evidence_documents WHERE document_id = 'd4444444-4444-4444-4444-444444444444'::uuid$$,
  'User A: cannot read Org B evidence documents');

INSERT INTO pgtap_out SELECT isnt_empty(
  $$SELECT * FROM dualpay.evidence_documents WHERE document_id = 'c3333333-3333-3333-3333-333333333333'::uuid$$,
  'User A: can read own evidence documents');

-- =============================================================================
-- SECTION 6: SECURITY DEFINER helper function correctness
-- =============================================================================

SELECT reset_role();

INSERT INTO pgtap_out SELECT is(
  dualpay.is_org_member('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-ffff-0000-0000-000000000001'::uuid),
  true, 'is_org_member: true for valid membership');

INSERT INTO pgtap_out SELECT is(
  dualpay.is_org_member('bbbbbbbb-0000-0000-0000-000000000002'::uuid, 'aaaaaaaa-ffff-0000-0000-000000000001'::uuid),
  false, 'is_org_member: false for cross-org');

INSERT INTO pgtap_out SELECT is(
  dualpay.has_org_role('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-ffff-0000-0000-000000000001'::uuid, ARRAY['analyst', 'manager']),
  true, 'has_org_role: analyst can perform analyst action in own org');

INSERT INTO pgtap_out SELECT is(
  dualpay.has_org_role('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-ffff-0000-0000-000000000001'::uuid, ARRAY['owner', 'admin']),
  false, 'has_org_role: analyst cannot perform admin action');

-- =============================================================================
-- SECTION 7: Storage policy existence (schema-level)
-- =============================================================================

INSERT INTO pgtap_out SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'evidence_storage_select'),
  'evidence_storage_select policy exists on storage.objects');

INSERT INTO pgtap_out SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'evidence_storage_select' AND qual LIKE '%IS NULL%'),
  'evidence_storage_select: null-folder fallback has been removed');

-- =============================================================================
-- SECTION 8: Core RLS policy existence (schema-qualified -- see header note:
-- valtaris-nucleus's own `public` schema, same project, has same-named
-- tables, so an unqualified lookup here would be ambiguous)
-- =============================================================================

INSERT INTO pgtap_out SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='dualpay' AND tablename='claims' AND policyname='claims_select'), 'RLS policy exists: dualpay.claims_select');
INSERT INTO pgtap_out SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='dualpay' AND tablename='claims' AND policyname='claims_insert'), 'RLS policy exists: dualpay.claims_insert');
INSERT INTO pgtap_out SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='dualpay' AND tablename='payer_contracts' AND policyname LIKE '%select%'), 'RLS policy exists: dualpay.payer_contracts select');
INSERT INTO pgtap_out SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='dualpay' AND tablename='evidence_documents' AND policyname='evidence_documents_select'), 'RLS policy exists: dualpay.evidence_documents_select');
INSERT INTO pgtap_out SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='dualpay' AND tablename='ops_events' AND policyname LIKE '%ops_events%'), 'RLS policy exists: dualpay.ops_events (any)');
INSERT INTO pgtap_out SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='dualpay' AND tablename='job_queue' AND policyname LIKE '%job_queue%'), 'RLS policy exists: dualpay.job_queue (any)');
INSERT INTO pgtap_out SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='dualpay' AND tablename='recovery_lineage_events' AND policyname LIKE '%lineage%'), 'RLS policy exists: dualpay.recovery_lineage_events (any)');
INSERT INTO pgtap_out SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='dualpay' AND tablename='automation_jobs' AND policyname LIKE '%automation%'), 'RLS policy exists: dualpay.automation_jobs (any)');

INSERT INTO pgtap_out SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('prevent_ops_events_update', 'prevent_ops_events_delete') AND tgrelid = 'dualpay.ops_events'::regclass),
  'ops_events immutability trigger(s) exist');

INSERT INTO pgtap_out SELECT ok(
  NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges WHERE routine_schema = 'dualpay' AND routine_name = 'claim_next_queue_job' AND grantee = 'authenticated' AND privilege_type = 'EXECUTE'),
  'claim_next_queue_job: NOT executable by authenticated (grant table)');

-- =============================================================================
-- CLEANUP
-- =============================================================================
-- No DELETE statements here on purpose. ops_events is protected by an
-- immutability trigger that fires for every role, postgres/superuser
-- included -- a SECURITY DEFINER cleanup helper doesn't bypass it
-- either, since BEFORE triggers fire regardless of who's deleting. An
-- earlier version of this cleanup tried DELETE FROM organizations,
-- which cascades into ops_events via FK and hits that same trigger.
-- The whole file already runs inside one transaction that ends in
-- ROLLBACK, so there is nothing to clean up -- verified live: a
-- follow-up query after ROLLBACK confirmed zero residual rows in every
-- table this file touches, and zero leftover helper functions.

SELECT reset_role();

DROP FUNCTION IF EXISTS set_authenticated_user(uuid);
DROP FUNCTION IF EXISTS reset_role();

-- Deterministic summary, independent of plan()/finish() (see header
-- note on why those are unreliable here under role-switching): failed
-- should be 0 and failure_lines should be null.
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE line LIKE 'not ok%') AS failed,
  array_agg(line) FILTER (WHERE line LIKE 'not ok%') AS failure_lines
FROM pgtap_out;

ROLLBACK;
