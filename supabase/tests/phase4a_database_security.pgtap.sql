BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = extensions, public, auth, storage;

SELECT no_plan();

-- -----------------------------------------------------------------------------
-- Fixtures (real rows, real roles, real RLS execution)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  INSERT INTO public.organizations (org_id, name)
  VALUES
    ('11111111-1111-1111-1111-111111111111', 'Phase4A Org A'),
    ('22222222-2222-2222-2222-222222222222', 'Phase4A Org B')
  ON CONFLICT (org_id) DO NOTHING;

  INSERT INTO public.organization_members (org_id, user_id, role)
  VALUES
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner'),
    ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'viewer'),
    ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'analyst'),
    ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'admin'),
    ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'manager'),
    ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'owner')
  ON CONFLICT (org_id, user_id) DO NOTHING;

  INSERT INTO public.claims (
    claim_id, member_id, provider_name, service_date_from, status, total_billed_cents, payload, org_id
  ) VALUES
    ('phase4a-claim-a', 'member-a', 'Provider A', DATE '2026-01-01', 'open', 1000, '{}'::jsonb, '11111111-1111-1111-1111-111111111111'),
    ('phase4a-claim-b', 'member-b', 'Provider B', DATE '2026-01-02', 'open', 2000, '{}'::jsonb, '22222222-2222-2222-2222-222222222222')
  ON CONFLICT (claim_id) DO NOTHING;

  INSERT INTO public.cases (case_id, member_id, status, description, tags, org_id)
  VALUES
    ('phase4a-case-a', 'member-a', 'OPEN', 'case A', '{}'::text[], '11111111-1111-1111-1111-111111111111')
  ON CONFLICT (case_id) DO NOTHING;

  INSERT INTO public.ops_events (
    event_id, kind, summary, payload, actor, actor_user_id, org_id
  ) VALUES (
    'phase4a-audit-event', 'phase4a_seed', 'Phase4A seed audit event', '{}'::jsonb, 'seed', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'
  ) ON CONFLICT (event_id) DO NOTHING;
END
$$;

-- Storage fixtures with dynamic column compatibility.
DO $block$
DECLARE
  has_public boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'public'
  ) INTO has_public;

  IF has_public THEN
    EXECUTE $sql$
      INSERT INTO storage.buckets (id, name, public)
      VALUES
        ('evidence-documents', 'evidence-documents', false),
        ('appeal-packets', 'appeal-packets', false)
      ON CONFLICT (id) DO NOTHING
    $sql$;
  ELSE
    EXECUTE $sql$
      INSERT INTO storage.buckets (id, name)
      VALUES
        ('evidence-documents', 'evidence-documents'),
        ('appeal-packets', 'appeal-packets')
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;
END
$block$;

DO $block$
DECLARE
  has_owner boolean;
  has_owner_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'owner'
  ) INTO has_owner;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'owner_id'
  ) INTO has_owner_id;

  IF has_owner THEN
    EXECUTE $sql$
      INSERT INTO storage.objects (id, bucket_id, name, owner)
      VALUES
        ('00000000-0000-0000-0000-0000000000a1', 'evidence-documents', '11111111-1111-1111-1111-111111111111/phase4a-a.txt', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
        ('00000000-0000-0000-0000-0000000000b1', 'evidence-documents', '22222222-2222-2222-2222-222222222222/phase4a-b.txt', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
      ON CONFLICT (id) DO NOTHING
    $sql$;
  ELSIF has_owner_id THEN
    EXECUTE $sql$
      INSERT INTO storage.objects (id, bucket_id, name, owner_id)
      VALUES
        ('00000000-0000-0000-0000-0000000000a1', 'evidence-documents', '11111111-1111-1111-1111-111111111111/phase4a-a.txt', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
        ('00000000-0000-0000-0000-0000000000b1', 'evidence-documents', '22222222-2222-2222-2222-222222222222/phase4a-b.txt', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
      ON CONFLICT (id) DO NOTHING
    $sql$;
  ELSE
    EXECUTE $sql$
      INSERT INTO storage.objects (id, bucket_id, name)
      VALUES
        ('00000000-0000-0000-0000-0000000000a1', 'evidence-documents', '11111111-1111-1111-1111-111111111111/phase4a-a.txt'),
        ('00000000-0000-0000-0000-0000000000b1', 'evidence-documents', '22222222-2222-2222-2222-222222222222/phase4a-b.txt')
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;
END
$block$;

-- -----------------------------------------------------------------------------
-- RLS enablement checks
-- -----------------------------------------------------------------------------

SELECT is(
  (
    SELECT count(*)::int
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'claims','organization_members','ops_events','evidence_documents',
        'appeal_recovery_cases','underpayment_disputes','recovery_outcomes','system_config'
      )
      AND c.relrowsecurity
  ),
  8,
  'Protected operational/security tables have RLS enabled'
);

-- -----------------------------------------------------------------------------
-- Tenant isolation + anonymous access
-- -----------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

SELECT is(
  (SELECT count(*)::int FROM public.claims WHERE claim_id = 'phase4a-claim-b'),
  0,
  'Org A cannot SELECT Org B claims'
);

SELECT is(
  (
    WITH upd AS (
      UPDATE public.claims
      SET status = 'denied'
      WHERE claim_id = 'phase4a-claim-b'
      RETURNING 1
    )
    SELECT count(*)::int FROM upd
  ),
  0,
  'Org A cannot UPDATE Org B claims'
);

SELECT is(
  (
    WITH del AS (
      DELETE FROM public.claims
      WHERE claim_id = 'phase4a-claim-b'
      RETURNING 1
    )
    SELECT count(*)::int FROM del
  ),
  0,
  'Org A cannot DELETE Org B claims'
);

SELECT throws_ok(
  $$
    INSERT INTO public.claims (
      claim_id, member_id, provider_name, service_date_from, status, total_billed_cents, payload, org_id
    ) VALUES (
      'phase4a-cross-org-insert',
      'member-x',
      'Provider X',
      DATE '2026-01-03',
      'open',
      3000,
      '{}'::jsonb,
      '22222222-2222-2222-2222-222222222222'
    )
  $$,
  '42501',
  'Org A cannot INSERT into Org B tenant scope'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);

SELECT throws_ok(
  $$ SELECT claim_id FROM public.claims LIMIT 1 $$,
  '42501',
  'Anonymous role cannot read protected claims table'
);

RESET ROLE;

-- -----------------------------------------------------------------------------
-- SECURITY DEFINER hardening and authorization
-- -----------------------------------------------------------------------------

SELECT is(
  (
    SELECT count(*)::int
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (
        p.proconfig IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg = 'search_path=public'
        )
      )
  ),
  0,
  'All public SECURITY DEFINER functions pin search_path=public'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.claim_next_queue_job(text)', 'EXECUTE') = false,
  'Authenticated role lacks EXECUTE on claim_next_queue_job'
);

SELECT ok(
  has_function_privilege('service_role', 'public.claim_next_queue_job(text)', 'EXECUTE'),
  'Service role has EXECUTE on claim_next_queue_job'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

SELECT throws_ok(
  $$ SELECT public.claim_next_queue_job('phase4a-worker') $$,
  '42501',
  'Unauthorized role cannot invoke privileged queue-claim SECURITY DEFINER function'
);

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$ SELECT public.claim_next_queue_job('phase4a-worker-service') $$,
  'Service role can invoke claim_next_queue_job'
);

RESET ROLE;

-- -----------------------------------------------------------------------------
-- Storage isolation
-- -----------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

SELECT is(
  (
    SELECT count(*)::int
    FROM storage.objects
    WHERE bucket_id = 'evidence-documents'
      AND name LIKE '22222222-2222-2222-2222-222222222222/%'
  ),
  0,
  'Org A cannot read Org B evidence bucket objects'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM storage.objects
    WHERE bucket_id = 'evidence-documents'
      AND name LIKE '11111111-1111-1111-1111-111111111111/%'
  ),
  1,
  'Org A can read own evidence bucket objects'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);

SELECT throws_ok(
  $$ SELECT id FROM storage.objects WHERE bucket_id = 'evidence-documents' LIMIT 1 $$,
  '42501',
  'Anonymous role cannot access private storage objects table'
);

RESET ROLE;

-- -----------------------------------------------------------------------------
-- Audit immutability (ops_events append-only)
-- -----------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

SELECT is(
  (
    WITH upd AS (
      UPDATE public.ops_events
      SET summary = 'tamper-attempt'
      WHERE event_id = 'phase4a-audit-event'
      RETURNING 1
    )
    SELECT count(*)::int FROM upd
  ),
  0,
  'Ordinary authenticated role cannot UPDATE ops_events rows'
);

SELECT is(
  (
    WITH del AS (
      DELETE FROM public.ops_events
      WHERE event_id = 'phase4a-audit-event'
      RETURNING 1
    )
    SELECT count(*)::int FROM del
  ),
  0,
  'Ordinary authenticated role cannot DELETE ops_events rows'
);

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$ UPDATE public.ops_events SET summary = 'service-role-tamper' WHERE event_id = 'phase4a-audit-event' $$,
  'P0001',
  'Append-only trigger blocks UPDATE even for privileged role'
);

SELECT throws_ok(
  $$ DELETE FROM public.ops_events WHERE event_id = 'phase4a-audit-event' $$,
  'P0001',
  'Append-only trigger blocks DELETE even for privileged role'
);

RESET ROLE;

-- -----------------------------------------------------------------------------
-- Privileged operations (current authorization behavior)
-- -----------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true); -- viewer

SELECT throws_ok(
  $$
    INSERT INTO public.idempotency_keys (key, claim_id, org_id, actor)
    VALUES ('phase4a-key-viewer', 'phase4a-claim-a', '11111111-1111-1111-1111-111111111111', 'viewer-test')
  $$,
  '42501',
  'Viewer cannot perform payment/idempotency write operation'
);

SELECT throws_ok(
  $$
    INSERT INTO public.recovery_outcomes (
      outcome_id, claim_id, denial_id, payer_id, resolution_type, resolution_date,
      denied_amount_cents, recovered_amount_cents, unrecovered_amount_cents, notes, payload, org_id
    ) VALUES (
      'phase4a-outcome-viewer', 'phase4a-claim-a', NULL, NULL,
      'written_off', now(), 1000, 0, 1000, 'viewer attempt', '{}'::jsonb,
      '11111111-1111-1111-1111-111111111111'
    )
  $$,
  '42501',
  'Viewer cannot create recovery/write-off outcome'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', true); -- analyst

SELECT lives_ok(
  $$
    INSERT INTO public.idempotency_keys (key, claim_id, org_id, actor)
    VALUES ('phase4a-key-analyst', 'phase4a-claim-a', '11111111-1111-1111-1111-111111111111', 'analyst-test')
  $$,
  'Analyst can perform payment/idempotency write operation'
);

SELECT lives_ok(
  $$
    INSERT INTO public.recovery_outcomes (
      outcome_id, claim_id, denial_id, payer_id, resolution_type, resolution_date,
      denied_amount_cents, recovered_amount_cents, unrecovered_amount_cents, notes, payload, org_id
    ) VALUES (
      'phase4a-outcome-analyst', 'phase4a-claim-a', NULL, NULL,
      'written_off', now(), 1000, 0, 1000, 'analyst write-off', '{}'::jsonb,
      '11111111-1111-1111-1111-111111111111'
    )
  $$,
  'Analyst can create recovery/write-off outcome'
);

SELECT throws_ok(
  $$ DELETE FROM public.recovery_outcomes WHERE outcome_id = 'phase4a-outcome-analyst' $$,
  '42501',
  'Analyst cannot delete recovery outcomes (requires manager/admin/owner)'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true); -- admin

SELECT lives_ok(
  $$
    INSERT INTO public.organization_members (org_id, user_id, role)
    VALUES ('11111111-1111-1111-1111-111111111111', 'abababab-abab-abab-abab-abababababab', 'viewer')
  $$,
  'Admin can perform organization administration (member add)'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', true); -- manager

SELECT throws_ok(
  $$
    INSERT INTO public.organization_members (org_id, user_id, role)
    VALUES ('11111111-1111-1111-1111-111111111111', 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd', 'viewer')
  $$,
  '42501',
  'Manager cannot perform organization administration member add'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

SELECT throws_ok(
  $$ SELECT key FROM public.system_config LIMIT 1 $$,
  '42501',
  'Authenticated users cannot read security configuration table'
);

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$ SELECT key FROM public.system_config LIMIT 1 $$,
  'Service role can read security configuration table'
);

RESET ROLE;

-- -----------------------------------------------------------------------------
-- Additional RLS authorized behavior checks (positive path)
-- -----------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

SELECT is(
  (SELECT count(*)::int FROM public.claims WHERE claim_id = 'phase4a-claim-a'),
  1,
  'Authorized tenant can SELECT own claim'
);

SELECT is(
  (
    WITH upd AS (
      UPDATE public.claims
      SET status = 'in_progress'
      WHERE claim_id = 'phase4a-claim-a'
      RETURNING 1
    )
    SELECT count(*)::int FROM upd
  ),
  1,
  'Authorized tenant can UPDATE own claim'
);

SELECT is(
  (
    WITH ins AS (
      INSERT INTO public.case_events (
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
    SELECT count(*)::int FROM ins
  ),
  1,
  'Authorized tenant can INSERT case action event in own org'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
