// stripe-webhook — receives Stripe events for the contingency-fee billing
// flow. Verifies the Stripe-Signature header itself (no Supabase JWT is
// possible here), so this function must be deployed with verify_jwt=false.
//
// Handles:
//  - checkout.session.completed (mode=setup): attaches the verified bank
//    account as the customer's default payment method, marks the org
//    ach_connected_at so stripe-billing-rollup can charge_automatically.
//  - invoice.finalized / paid / payment_failed / voided: mirrors Stripe's
//    invoice status onto dualpay.billing_invoices.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripeKey || !webhookSecret) return json({ error: 'Stripe billing is not configured yet' }, 503);
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return json({ error: 'missing stripe-signature header' }, 400);

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (e) {
    return json({ error: `signature verification failed: ${(e as Error).message}` }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'dualpay' } },
  );

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'setup' && session.customer && session.setup_intent) {
          const setupIntent = await stripe.setupIntents.retrieve(String(session.setup_intent));
          const paymentMethod = setupIntent.payment_method;
          if (paymentMethod) {
            await stripe.customers.update(String(session.customer), {
              invoice_settings: { default_payment_method: String(paymentMethod) },
            });
            await admin.from('organizations')
              .update({ ach_connected_at: new Date().toISOString() })
              .eq('stripe_customer_id', String(session.customer));
          }
        }
        break;
      }

      case 'invoice.finalized': {
        const invoice = event.data.object as Stripe.Invoice;
        await admin.from('billing_invoices').update({
          status: 'open',
          hosted_invoice_url: invoice.hosted_invoice_url ?? null,
          finalized_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('stripe_invoice_id', invoice.id);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        await admin.from('billing_invoices').update({
          status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('stripe_invoice_id', invoice.id);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await admin.from('billing_invoices').update({
          status: 'payment_failed', updated_at: new Date().toISOString(),
        }).eq('stripe_invoice_id', invoice.id);
        break;
      }

      case 'invoice.voided': {
        const invoice = event.data.object as Stripe.Invoice;
        await admin.from('billing_invoices').update({
          status: 'void', updated_at: new Date().toISOString(),
        }).eq('stripe_invoice_id', invoice.id);
        break;
      }

      default:
        // Unhandled event types are expected — Stripe sends far more events
        // than this integration cares about. Acknowledge, do nothing.
        break;
    }

    await admin.from('ops_events').insert([{
      event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(),
      kind: 'stripe_webhook_received', actor: 'system:stripe-webhook',
      summary: `Stripe event ${event.type} processed`,
      payload: { stripe_event_id: event.id, type: event.type },
    }] as never);

    return json({ received: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
