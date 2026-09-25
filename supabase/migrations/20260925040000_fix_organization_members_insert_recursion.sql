-- Fixes a real, reproducible infinite-recursion bug (42P17) in
-- dualpay.organization_members' own INSERT policy, found while fixing
-- supabase/tests/phase4a_database_security.pgtap.sql (docs/RISK_REGISTER.md
-- risk #102). Confirmed live: any authenticated INSERT into
-- organization_members throws "infinite recursion detected in policy for
-- relation organization_members", regardless of role.
--
-- Root cause: the policy's own WITH CHECK contains a raw, non-privileged
-- subquery directly against organization_members (the bootstrap-check
-- "is this the very first member of a brand-new org"), evaluated under
-- the calling user's own permissions. Because that subquery targets the
-- SAME table the policy is attached to, evaluating it re-triggers RLS
-- policy evaluation on organization_members recursively -- the classic
-- Postgres RLS self-reference trap.
--
-- Fix: exactly the established pattern for is_org_member/has_org_role
-- (docs/adr/003-security-definer-choke-point.md, valtaris-nucleus repo)
-- -- move the self-referencing check into a SECURITY DEFINER function.
-- Its own internal query then runs with elevated privilege and never
-- re-triggers RLS, breaking the recursion.
--
-- Currently unreachable through the live app: AdminConsole.tsx's member
-- management exclusively calls the invite-member Edge Function (service
-- role, bypasses RLS entirely), never a direct client-side insert. This
-- is still a real bug worth fixing now, not a hypothetical one -- it's
-- a landmine for the next feature that does a direct authenticated
-- insert into this table, and it was reproducible with a 4-line repro.
create or replace function dualpay.org_has_no_members(_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'dualpay'
as $$
  select not exists (select 1 from dualpay.organization_members where org_id = _org_id)
$$;

drop policy if exists members_insert_bootstrap_or_admin on dualpay.organization_members;

create policy members_insert_bootstrap_or_admin
  on dualpay.organization_members
  for insert
  to authenticated
  with check (
    dualpay.has_org_role(org_id, (select auth.uid()), array['owner','admin'])
    or (user_id = (select auth.uid()) and dualpay.org_has_no_members(org_id))
  );
