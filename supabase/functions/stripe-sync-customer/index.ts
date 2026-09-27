// stripe-sync-customer — admin-only edge function that creates (if needed) a
// Stripe Customer for the caller's org and returns a Checkout Session URL in
// 'setup' mode so the org can connect + verify a bank account for ACH debit.
// The actual contingency-fee invoicing happens later, on the monthly
// stripe-billing-rollup cron — this function only sets up the payment method.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return json({ error: 'Stripe billing is not configured yet' }, 503);
    const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'missing bearer token' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, db: { schema: 'dualpay' } });
    const { data: userRes, error: uErr } = await asCaller.auth.getUser();
    if (uErr || !userRes.user) return json({ error: 'not authenticated' }, 401);
    const caller = userRes.user;

    const body = await req.json().catch(() => ({}));
    const orgId = String(body.org_id ?? '');
    const successUrl = String(body.success_url ?? '');
    const cancelUrl = String(body.cancel_url ?? '');
    if (!orgId) return json({ error: 'org_id required' }, 400);
    if (!successUrl || !cancelUrl) return json({ error: 'success_url and cancel_url required' }, 400);

    const admin = createClient(url, service, { db: { schema: 'dualpay' } });

    const { data: mem, error: mErr } = await admin
      .from('organization_members').select('role').eq('org_id', orgId).eq('user_id', caller.id).maybeSingle();
    if (mErr) return json({ error: mErr.message }, 500);
    if (!mem || !['owner', 'admin'].includes(mem.role)) {
      return json({ error: 'forbidden: admin/owner required' }, 403);
    }

    const { data: org, error: oErr } = await admin
      .from('organizations').select('org_id, name, billing_email, stripe_customer_id').eq('org_id', orgId).single();
    if (oErr || !org) return json({ error: oErr?.message ?? 'org not found' }, 404);

    let customerId = org.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: org.name,
        email: org.billing_email ?? undefined,
        metadata: { org_id: orgId },
      });
      customerId = customer.id;
      const { error: updErr } = await admin
        .from('organizations').update({ stripe_customer_id: customerId }).eq('org_id', orgId);
      if (updErr) return json({ error: updErr.message }, 500);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: customerId,
      payment_method_types: ['us_bank_account'],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return json({ ok: true, url: session.url, customer_id: customerId });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
