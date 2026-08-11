-- pgTAP tests: rpc_log_write_off role-based authorization
--
-- Verifies that write-off is restricted to analyst/manager/admin/owner roles.
-- Non-members and viewer-role members must be rejected.
-- Tenant isolation (cross-org call) must remain enforced.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = extensions, public, auth, storage;

SELECT no_plan();

-- -----------------------------------------------------------------------------
-- Fixtures (reuse UUIDs compatible with phase4a seeds; add new ones as needed)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  INSERT INTO public.organizations (org_id, name)
  VALUES
    ('11111111-1111-1111-1111-111111111111', 'WriteOff Org A'),
    ('22222222-2222-2222-2222-222222222222', 'WriteOff Org B')
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
    claim_id, member_id, provider_name, service_date_from, status,
    total_billed_cents, payload, org_id
  ) VALUES
    ('writeoff-claim-a', 'member-a', 'Provider A', DATE '2026-01-01', 'open', 1000, '{}'::jsonb, '11111111-1111-1111-1111-111111111111'),
    ('writeoff-claim-b', 'member-b', 'Provider B', DATE '2026-01-02', 'open', 2000, '{}'::jsonb, '22222222-2222-2222-2222-222222222222')
  ON CONFLICT (claim_id) DO NOTHING;
END
$$;

-- -----------------------------------------------------------------------------
-- 1. Unauthenticated caller (no auth.uid) is rejected
-- -----------------------------------------------------------------------------

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT throws_ok(
  $$
    SELECT public.rpc_log_write_off(
      'wo-key-unauth', 'writeoff-claim-a',
      '11111111-1111-1111-1111-111111111111'::uuid,
      'unauth-actor', 'test write-off'
    )
  $$,
  'P0001',
  'Unauthenticated caller cannot invoke rpc_log_write_off'
);

-- -----------------------------------------------------------------------------
-- 2. Non-member (org B owner calling on org A) is rejected
-- -----------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true); -- Org B owner, not a member of Org A

SELECT throws_ok(
  $$
    SELECT public.rpc_log_write_off(
      'wo-key-nonmember', 'writeoff-claim-a',
      '11111111-1111-1111-1111-111111111111'::uuid,
      'org-b-owner', 'cross-org write-off attempt'
    )
  $$,
  'P0001',
  'Non-member (Org B owner) cannot write off a claim in Org A'
);

-- -----------------------------------------------------------------------------
-- 3. Viewer-role member is rejected (insufficient role)
-- -----------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true); -- viewer

SELECT throws_ok(
  $$
    SELECT public.rpc_log_write_off(
      'wo-key-viewer', 'writeoff-claim-a',
      '11111111-1111-1111-1111-111111111111'::uuid,
      'viewer-actor', 'viewer write-off attempt'
    )
  $$,
  'P0001',
  'Viewer-role member cannot invoke rpc_log_write_off'
);

-- -----------------------------------------------------------------------------
-- 4. Analyst can write off (authorized role)
-- -----------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', true); -- analyst

SELECT lives_ok(
  $$
    SELECT public.rpc_log_write_off(
      'wo-key-analyst-1', 'writeoff-claim-a',
      '11111111-1111-1111-1111-111111111111'::uuid,
      'analyst-actor', 'analyst authorized write-off'
    )
  $$,
  'Analyst can invoke rpc_log_write_off'
);

-- Idempotency: same key returns already_consumed = true
SELECT is(
  (
    SELECT (public.rpc_log_write_off(
      'wo-key-analyst-1', 'writeoff-claim-a',
      '11111111-1111-1111-1111-111111111111'::uuid,
      'analyst-actor', 'analyst authorized write-off'
    ) ->> 'already_consumed')::boolean
  ),
  true,
  'Duplicate idempotency key returns already_consumed=true for analyst'
);

-- -----------------------------------------------------------------------------
-- 5. Manager can write off (authorized role)
-- -----------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', true); -- manager

SELECT lives_ok(
  $$
    SELECT public.rpc_log_write_off(
      'wo-key-manager-1', 'writeoff-claim-a',
      '11111111-1111-1111-1111-111111111111'::uuid,
      'manager-actor', 'manager authorized write-off'
    )
  $$,
  'Manager can invoke rpc_log_write_off'
);

-- -----------------------------------------------------------------------------
-- 6. Admin can write off (authorized role)
-- -----------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true); -- admin

SELECT lives_ok(
  $$
    SELECT public.rpc_log_write_off(
      'wo-key-admin-1', 'writeoff-claim-a',
      '11111111-1111-1111-1111-111111111111'::uuid,
      'admin-actor', 'admin authorized write-off'
    )
  $$,
  'Admin can invoke rpc_log_write_off'
);

-- -----------------------------------------------------------------------------
-- 7. Owner can write off (authorized role)
-- -----------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true); -- owner

SELECT lives_ok(
  $$
    SELECT public.rpc_log_write_off(
      'wo-key-owner-1', 'writeoff-claim-a',
      '11111111-1111-1111-1111-111111111111'::uuid,
      'owner-actor', 'owner authorized write-off'
    )
  $$,
  'Owner can invoke rpc_log_write_off'
);

-- -----------------------------------------------------------------------------
-- 8. Tenant isolation: authorized Org A user cannot write off a claim in Org B
-- -----------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true); -- Org A owner

SELECT throws_ok(
  $$
    SELECT public.rpc_log_write_off(
      'wo-key-cross-tenant', 'writeoff-claim-b',
      '22222222-2222-2222-2222-222222222222'::uuid,
      'org-a-owner', 'cross-tenant write-off attempt'
    )
  $$,
  'P0001',
  'Org A owner cannot write off a claim belonging to Org B'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
