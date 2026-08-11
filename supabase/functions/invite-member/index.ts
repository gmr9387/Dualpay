// invite-member — admin-only edge function to invite a user to the caller's
// current org.  Uses the service role to call auth.admin.inviteUserByEmail and
// stamps `invited_org_id` + `invited_role` in user metadata so the
// `handle_new_user_org` trigger routes the new auth user into that org.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const ROLES = new Set(['admin', 'manager', 'analyst', 'viewer']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'missing bearer token' }, 401);
    }

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Identify caller
    const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes, error: uErr } = await asCaller.auth.getUser();
    if (uErr || !userRes.user) return json({ error: 'not authenticated' }, 401);
    const caller = userRes.user;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? 'invite');
    const orgId = String(body.org_id ?? '');
    if (!orgId) return json({ error: 'org_id required' }, 400);

    const admin = createClient(url, service);

    // Authorization: caller must be admin/owner in the target org
    const { data: mem, error: mErr } = await admin
      .from('organization_members')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', caller.id)
      .maybeSingle();
    if (mErr) return json({ error: mErr.message }, 500);
    if (!mem || !['owner', 'admin'].includes(mem.role)) {
      return json({ error: 'forbidden: admin/owner required' }, 403);
    }

    if (action === 'invite' || action === 'resend') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const role  = String(body.role ?? 'analyst');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid email' }, 400);
      if (!ROLES.has(role)) return json({ error: 'invalid role' }, 400);

      const redirectTo = String(body.redirect_to ?? '') || undefined;

      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { invited_org_id: orgId, invited_role: role, invited_by: caller.id },
        redirectTo,
      });
      if (error) return json({ error: error.message }, 400);

      // If the user already exists, pre-attach membership so the invite lands them in the right org.
      if (data?.user?.id) {
        await admin
          .from('organization_members')
          .upsert({ org_id: orgId, user_id: data.user.id, role }, { onConflict: 'org_id,user_id' });
      }

      return json({ ok: true, user_id: data?.user?.id ?? null });
    }

    if (action === 'remove') {
      const userId = String(body.user_id ?? '');
      if (!userId) return json({ error: 'user_id required' }, 400);
      if (userId === caller.id) return json({ error: 'cannot remove yourself' }, 400);
      const { error } = await admin
        .from('organization_members')
        .delete()
        .eq('org_id', orgId)
        .eq('user_id', userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'list') {
      const { data: rows, error } = await admin
        .from('organization_members')
        .select('user_id, role, created_at')
        .eq('org_id', orgId);
      if (error) return json({ error: error.message }, 400);

      // Enrich with email
      const enriched = await Promise.all((rows ?? []).map(async (r) => {
        const { data: u } = await admin.auth.admin.getUserById(r.user_id);
        return {
          user_id: r.user_id,
          role: r.role,
          created_at: r.created_at,
          email: u?.user?.email ?? null,
          invited_at: u?.user?.invited_at ?? null,
          last_sign_in_at: u?.user?.last_sign_in_at ?? null,
        };
      }));
      return json({ ok: true, members: enriched });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
