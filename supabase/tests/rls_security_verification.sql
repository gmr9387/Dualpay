-- =============================================================================
-- PR #5 — PostgreSQL RLS + SECURITY DEFINER Live Verification (pgTAP)
-- =============================================================================
-- PURPOSE
-- -------
-- This file contains pgTAP tests that MUST be run against a live Supabase/
-- PostgreSQL instance to provide full database-level security proof.
--
-- It is NOT executed by the vitest suite (no live DB is available in CI).
-- It is provided here so that any engineer with a local Supabase stack can
-- execute it via:
--   supabase test db
--
-- PREREQUISITES
-- -------------
--   1. Local Supabase running: supabase start
--   2. All migrations applied: supabase db reset
--   3. pgTAP extension available (included in Supabase local dev)
--
-- EXECUTION
-- ---------
--   psql "******localhost:54322/postgres" \
--     -f supabase/tests/rls_security_verification.sql
--
-- STATUS: PENDING — environment does not have a live Supabase/PostgreSQL
--         instance available.  All test bodies document the REQUIRED
--         assertions; results must be verified manually before claiming
--         live-DB proof.
-- =============================================================================

BEGIN;
SELECT plan(30);

-- =============================================================================
-- SETUP: Two organizations and two users
-- =============================================================================
-- NOTE: In a real Supabase environment auth.users is managed by GoTrue.
-- For pgTAP we simulate the JWT claims via set_config().
-- The helper set_config('request.jwt.claims', ...) is how Supabase exposes
-- auth.uid() to RLS policies inside a transaction.

DO $$
DECLARE
  org_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001'::uuid;
  org_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002'::uuid;
  user_a uuid := 'aaaaaaaa-ffff-0000-0000-000000000001'::uuid;
  user_b uuid := 'bbbbbbbb-ffff-0000-0000-000000000002'::uuid;
BEGIN
  -- Organizations
  INSERT INTO public.organizations (org_id, name) VALUES (org_a, 'Test Org A')
    ON CONFLICT (org_id) DO NOTHING;
  INSERT INTO public.organizations (org_id, name) VALUES (org_b, 'Test Org B')
    ON CONFLICT (org_id) DO NOTHING;

  -- Memberships (bypass RLS as postgres/service_role for setup)
  INSERT INTO public.organization_members (org_id, user_id, role)
    VALUES (org_a, user_a, 'analyst') ON CONFLICT DO NOTHING;
  INSERT INTO public.organization_members (org_id, user_id, role)
    VALUES (org_b, user_b, 'analyst') ON CONFLICT DO NOTHING;
END $$;

-- =============================================================================
-- HELPER: Switch to authenticated role with a given JWT subject
-- =============================================================================

CREATE OR REPLACE FUNCTION set_authenticated_user(uid uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reset_role() RETURNS void AS $$
BEGIN
  SET LOCAL ROLE postgres;
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- SECTION 1: SECURITY DEFINER function access control
-- =============================================================================

-- Test 1: anon cannot execute claim_next_queue_job
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.claim_next_queue_job('contract_recovery_analysis')$$,
  '42501',
  NULL,
  'anon: claim_next_queue_job denied'
);

-- Test 2: authenticated cannot execute claim_next_queue_job
SELECT set_authenticated_user('aaaaaaaa-ffff-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$SELECT public.claim_next_queue_job('contract_recovery_analysis')$$,
  '42501',
  NULL,
  'authenticated: claim_next_queue_job denied'
);

-- Test 3: anon cannot execute recover_stalled_queue_jobs
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.recover_stalled_queue_jobs(30)$$,
  '42501',
  NULL,
  'anon: recover_stalled_queue_jobs denied'
);

-- Test 4: authenticated cannot execute recover_stalled_queue_jobs
SELECT set_authenticated_user('aaaaaaaa-ffff-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$SELECT public.recover_stalled_queue_jobs(30)$$,
  '42501',
  NULL,
  'authenticated: recover_stalled_queue_jobs denied'
);

SELECT reset_role();

-- =============================================================================
-- SECTION 2: RLS SELECT isolation — claims
-- =============================================================================

INSERT INTO public.claims (claim_id, org_id, payer_name, status)
  VALUES
    ('PGTAP-CLM-A1', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Payer A', 'denied'),
    ('PGTAP-CLM-B1', 'bbbbbbbb-0000-0000-0000-000000000002'::uuid, 'Payer B', 'denied')
  ON CONFLICT DO NOTHING;

-- Test 5: User A sees only Org A claims
SELECT set_authenticated_user('aaaaaaaa-ffff-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT org_id::text FROM public.claims WHERE claim_id LIKE 'PGTAP-CLM-%' ORDER BY claim_id$$,
  ARRAY['aaaaaaaa-0000-0000-0000-000000000001'],
  'User A: only sees Org A claims'
);

-- Test 6: User A INSERT into Org B fails
SELECT throws_ok(
  $$INSERT INTO public.claims (claim_id, org_id, payer_name, status)
    VALUES ('PGTAP-CLM-B-EVIL', 'bbbbbbbb-0000-0000-0000-000000000002'::uuid, 'Evil', 'denied')$$,
  NULL, NULL,
  'User A: cannot INSERT Org B claim'
);

-- Test 7: User B sees only Org B claims
SELECT set_authenticated_user('bbbbbbbb-ffff-0000-0000-000000000002'::uuid);
SELECT results_eq(
  $$SELECT org_id::text FROM public.claims WHERE claim_id LIKE 'PGTAP-CLM-%' ORDER BY claim_id$$,
  ARRAY['bbbbbbbb-0000-0000-0000-000000000002'],
  'User B: only sees Org B claims'
);

-- =============================================================================
-- SECTION 3: ops_events immutability trigger
-- =============================================================================

SELECT reset_role();

INSERT INTO public.ops_events (event_id, org_id, kind, actor, summary, payload)
  VALUES ('PGTAP-EV-001',
          'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
          'test_event', 'pgtap', 'test', '{}')
  ON CONFLICT DO NOTHING;

-- Test 8: authenticated can INSERT ops_events
SELECT set_authenticated_user('aaaaaaaa-ffff-0000-0000-000000000001'::uuid);
SELECT lives_ok(
  $$INSERT INTO public.ops_events (event_id, org_id, kind, actor, summary, payload)
    VALUES ('PGTAP-EV-002',
            'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
            'test_event', 'pgtap-user', 'test insert', '{}')$$,
  'authenticated: INSERT ops_events succeeds'
);

-- Test 9: UPDATE raises trigger
SELECT throws_ok(
  $$UPDATE public.ops_events SET summary = 'tampered' WHERE event_id = 'PGTAP-EV-001'$$,
  NULL, 'ops_events is append-only',
  'authenticated: UPDATE ops_events raises trigger'
);

-- Test 10: DELETE raises trigger
SELECT throws_ok(
  $$DELETE FROM public.ops_events WHERE event_id = 'PGTAP-EV-001'$$,
  NULL, 'ops_events is append-only',
  'authenticated: DELETE ops_events raises trigger'
);

-- =============================================================================
-- SECTION 4: RLS isolation — contracts
-- =============================================================================

SELECT reset_role();

INSERT INTO public.contracts (contract_id, org_id, payer_name, contract_name, version, effective_date, status)
  VALUES
    ('PGTAP-CON-A1', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
     'Payer A', 'Contract A', '1.0', '2026-01-01', 'active'),
    ('PGTAP-CON-B1', 'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
     'Payer B', 'Contract B', '1.0', '2026-01-01', 'active')
  ON CONFLICT DO NOTHING;

-- Test 11: User A sees only Org A contracts
SELECT set_authenticated_user('aaaaaaaa-ffff-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT org_id::text FROM public.contracts WHERE contract_id LIKE 'PGTAP-CON-%' ORDER BY contract_id$$,
  ARRAY['aaaaaaaa-0000-0000-0000-000000000001'],
  'User A: only sees Org A contracts'
);

-- Test 12: User B cannot see Org A contracts
SELECT set_authenticated_user('bbbbbbbb-ffff-0000-0000-000000000002'::uuid);
SELECT is_empty(
  $$SELECT * FROM public.contracts WHERE contract_id = 'PGTAP-CON-A1'$$,
  'User B: cannot see Org A contract'
);

-- =============================================================================
-- SECTION 5: RLS isolation — evidence_documents
-- =============================================================================

SELECT reset_role();

INSERT INTO public.evidence_documents (document_id, org_id, file_name, file_type, file_size_bytes)
  VALUES
    ('PGTAP-DOC-A1', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'a.pdf', 'pdf', 1024),
    ('PGTAP-DOC-B1', 'bbbbbbbb-0000-0000-0000-000000000002'::uuid, 'b.pdf', 'pdf', 1024)
  ON CONFLICT DO NOTHING;

-- Test 13: User A cannot read Org B evidence documents
SELECT set_authenticated_user('aaaaaaaa-ffff-0000-0000-000000000001'::uuid);
SELECT is_empty(
  $$SELECT * FROM public.evidence_documents WHERE document_id = 'PGTAP-DOC-B1'$$,
  'User A: cannot read Org B evidence documents'
);

-- Test 14: User A can read own evidence documents
SELECT isnt_empty(
  $$SELECT * FROM public.evidence_documents WHERE document_id = 'PGTAP-DOC-A1'$$,
  'User A: can read own evidence documents'
);

-- =============================================================================
-- SECTION 6: SECURITY DEFINER helper function correctness
-- =============================================================================

SELECT reset_role();

-- Test 15: is_org_member true for valid membership
SELECT is(
  public.is_org_member(
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'aaaaaaaa-ffff-0000-0000-000000000001'::uuid
  ),
  true,
  'is_org_member: true for valid membership'
);

-- Test 16: is_org_member false for cross-org
SELECT is(
  public.is_org_member(
    'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
    'aaaaaaaa-ffff-0000-0000-000000000001'::uuid
  ),
  false,
  'is_org_member: false for cross-org'
);

-- Test 17: has_org_role true for analyst
SELECT is(
  public.has_org_role(
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'aaaaaaaa-ffff-0000-0000-000000000001'::uuid,
    ARRAY['analyst', 'manager']
  ),
  true,
  'has_org_role: analyst can perform analyst action in own org'
);

-- Test 18: has_org_role false for analyst attempting admin role
SELECT is(
  public.has_org_role(
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'aaaaaaaa-ffff-0000-0000-000000000001'::uuid,
    ARRAY['owner', 'admin']
  ),
  false,
  'has_org_role: analyst cannot perform admin action'
);

-- =============================================================================
-- SECTION 7: Storage policy existence (schema-level)
-- =============================================================================

-- Test 19: evidence_storage_select policy exists
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'evidence_storage_select'
  ),
  'evidence_storage_select policy exists on storage.objects'
);

-- Test 20: NULL-folder fallback removed (20260710182913 tightening)
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'evidence_storage_select'
    AND qual LIKE '%IS NULL%'
  ),
  'evidence_storage_select: null-folder fallback has been removed'
);

-- =============================================================================
-- SECTION 8: Core RLS policy existence
-- =============================================================================

SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename='claims' AND policyname='claims_select'),
  'RLS policy exists: claims_select'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename='claims' AND policyname='claims_insert'),
  'RLS policy exists: claims_insert'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contracts' AND policyname LIKE '%contract%select%'),
  'RLS policy exists: contracts select'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename='evidence_documents' AND policyname='evidence_documents_select'),
  'RLS policy exists: evidence_documents_select'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ops_events' AND policyname LIKE '%ops_events%'),
  'RLS policy exists: ops_events (any)'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename='job_queue' AND policyname LIKE '%job_queue%'),
  'RLS policy exists: job_queue (any)'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename='recovery_lineage_events' AND policyname LIKE '%lineage%'),
  'RLS policy exists: recovery_lineage_events (any)'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automation_jobs' AND policyname LIKE '%automation%'),
  'RLS policy exists: automation_jobs (any)'
);

-- Test 29: ops_events immutability trigger(s) exist
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname IN ('prevent_ops_events_update', 'prevent_ops_events_delete')
    AND tgrelid = 'public.ops_events'::regclass
  ),
  'ops_events immutability trigger(s) exist'
);

-- Test 30: authenticated cannot execute claim_next_queue_job (grant table check)
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_name = 'claim_next_queue_job'
    AND grantee = 'authenticated'
    AND privilege_type = 'EXECUTE'
  ),
  'claim_next_queue_job: NOT executable by authenticated (grant table)'
);

-- =============================================================================
-- CLEANUP
-- =============================================================================

SELECT reset_role();

-- ops_events is protected by an immutability trigger on UPDATE and DELETE,
-- but the trigger fires for 'authenticated' role only (BEFORE UPDATE/DELETE).
-- As postgres (superuser), the trigger still fires.  Use a SECURITY DEFINER
-- cleanup helper that runs as the trigger owner and suppresses the guard,
-- OR simply use TRUNCATE which bypasses row-level triggers.
-- We truncate only the rows we inserted by using a CTE executed under
-- SECURITY DEFINER context.
CREATE OR REPLACE FUNCTION _pgtap_delete_ops_event(eid text) RETURNS void AS $$
  DELETE FROM public.ops_events WHERE event_id = eid;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

SELECT _pgtap_delete_ops_event('PGTAP-EV-001');
SELECT _pgtap_delete_ops_event('PGTAP-EV-002');
DROP FUNCTION IF EXISTS _pgtap_delete_ops_event(text);

DELETE FROM public.evidence_documents WHERE document_id IN ('PGTAP-DOC-A1', 'PGTAP-DOC-B1');
DELETE FROM public.contracts WHERE contract_id IN ('PGTAP-CON-A1', 'PGTAP-CON-B1');
DELETE FROM public.claims WHERE claim_id IN ('PGTAP-CLM-A1', 'PGTAP-CLM-B1', 'PGTAP-CLM-B-EVIL');
DELETE FROM public.organization_members WHERE user_id IN (
  'aaaaaaaa-ffff-0000-0000-000000000001'::uuid,
  'bbbbbbbb-ffff-0000-0000-000000000002'::uuid
);
DELETE FROM public.organizations WHERE org_id IN (
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'bbbbbbbb-0000-0000-0000-000000000002'::uuid
);

DROP FUNCTION IF EXISTS set_authenticated_user(uuid);
DROP FUNCTION IF EXISTS reset_role();

SELECT * FROM finish();
ROLLBACK;
