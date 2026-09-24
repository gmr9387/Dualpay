-- Contractor/time-bound org access (RISK_REGISTER #56): organization_members
-- had no expiration mechanism, so contractor or temporary access had to be
-- manually revoked and never was automatically. Adds expires_at and wires
-- expiration into is_org_member/has_org_role -- the two SECURITY DEFINER
-- helpers every dualpay RLS policy routes through -- so every one of those
-- policies enforces the expiry automatically with no per-policy changes.

ALTER TABLE dualpay.organization_members
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;

CREATE OR REPLACE FUNCTION dualpay.is_org_member(_org_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'dualpay'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM dualpay.organization_members
    WHERE org_id = _org_id AND user_id = _user_id
      AND (expires_at IS NULL OR expires_at > now())
  )
$function$;

CREATE OR REPLACE FUNCTION dualpay.has_org_role(_org_id uuid, _user_id uuid, _roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'dualpay'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM dualpay.organization_members
    WHERE org_id = _org_id AND user_id = _user_id AND role = ANY(_roles)
      AND (expires_at IS NULL OR expires_at > now())
  )
$function$;

-- Carry an invited expiry through to the membership row created when an
-- invited user completes signup (mirrors invited_org_id/invited_role, which
-- already flow through user_metadata this same way).
CREATE OR REPLACE FUNCTION dualpay.handle_new_user_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'dualpay'
AS $function$
DECLARE
  invited_org uuid;
  invited_role text;
  invited_expires_at timestamptz;
  new_org_id uuid;
BEGIN
  invited_org := NULLIF(NEW.raw_user_meta_data ->> 'invited_org_id', '')::uuid;
  invited_role := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'invited_role', ''), 'analyst');
  invited_expires_at := NULLIF(NEW.raw_user_meta_data ->> 'invited_expires_at', '')::timestamptz;

  IF invited_org IS NOT NULL AND EXISTS (SELECT 1 FROM dualpay.organizations WHERE org_id = invited_org) THEN
    INSERT INTO dualpay.organization_members (org_id, user_id, role, expires_at)
    VALUES (invited_org, NEW.id, invited_role, invited_expires_at)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  INSERT INTO dualpay.organizations (name) VALUES ('My Organization') RETURNING org_id INTO new_org_id;
  INSERT INTO dualpay.organization_members (org_id, user_id, role) VALUES (new_org_id, NEW.id, 'owner');
  RETURN NEW;
END;
$function$;

-- Nightly hygiene: hard-delete memberships that expired more than a day ago.
-- Not the security boundary (is_org_member/has_org_role already deny access
-- the instant expires_at passes, independent of this job running) -- this
-- just keeps the table from accumulating stale expired rows.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-org-members') THEN
    PERFORM cron.unschedule('cleanup-expired-org-members');
  END IF;
END $$;

SELECT cron.schedule(
  'cleanup-expired-org-members',
  '0 3 * * *',
  $$DELETE FROM dualpay.organization_members WHERE expires_at IS NOT NULL AND expires_at < now() - interval '1 day'$$
);
