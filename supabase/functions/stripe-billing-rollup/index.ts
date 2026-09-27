// stripe-billing-rollup — monthly contingency-fee invoicing.
// Invoked by pg_cron (dualpay.dispatch_stripe_rollup(), see migration
// 20260927150000_stripe_billing_cron.sql) on the 1st of each month.
//
// For every org with a Stripe customer on file, rolls up every recovered-
// but-unbilled underpayment_disputes row into one Stripe invoice: one
// invoice item per dispute, invoiced via ACH (charge_automatically) once
// the org has connected a bank account, or send_invoice/net-15 otherwise.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';
import { corsHeaders } from '../_shared/cors.ts';
import { buildOrgInvoiceBatches, type UnbilledDispute } from '../_shared/billing-rollup.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'dualpay' } },
  );

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) {
    await admin.from('ops_events').insert([{
      event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(),
      kind: 'stripe_rollup_skipped', actor: 'system:stripe-billing-rollup',
      summary: 'Stripe billing rollup skipped — STRIPE_SECRET_KEY not configured',
      payload: {},
    }] as never);
    return json({ ok: true, orgs_billed: 0, skipped: 'stripe_not_configured' });
  }
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  const { data: disputeRows, error: dErr } = await admin
    .from('underpayment_disputes')
    .select('dispute_id, org_id, claim_id, payer_name, assessed_fee_cents, created_at')
    .eq('status', 'recovered')
    .gt('assessed_fee_cents', 0)
    .is('billing_invoice_id', null)
    .limit(5000);
  if (dErr) return json({ error: dErr.message }, 500);

  const batches = buildOrgInvoiceBatches((disputeRows ?? []) as UnbilledDispute[]);
  if (batches.length === 0) return json({ ok: true, orgs_billed: 0 });

  const { data: orgRows, error: oErr } = await admin
    .from('organizations')
    .select('org_id, stripe_customer_id, ach_connected_at')
    .in('org_id', batches.map((b) => b.org_id))
    .not('stripe_customer_id', 'is', null);
  if (oErr) return json({ error: oErr.message }, 500);

  const orgsByid = new Map((orgRows ?? []).map((o) => [o.org_id as string, o]));

  let orgsBilled = 0;
  const errors: Array<{ org_id: string; error: string }> = [];

  for (const batch of batches) {
    const org = orgsByid.get(batch.org_id) as { stripe_customer_id: string; ach_connected_at: string | null } | undefined;
    if (!org) continue; // No Stripe customer yet — leave unbilled until the org connects billing.

    try {
      for (const li of batch.line_items) {
        await stripe.invoiceItems.create({
          customer: org.stripe_customer_id,
          amount: li.amount_cents,
          currency: 'usd',
          description: li.description,
        });
      }

      const achConnected = Boolean(org.ach_connected_at);
      const invoice = await stripe.invoices.create({
        customer: org.stripe_customer_id,
        collection_method: achConnected ? 'charge_automatically' : 'send_invoice',
        days_until_due: achConnected ? undefined : 15,
        auto_advance: false,
        metadata: { org_id: batch.org_id },
      });
      const finalized = await stripe.invoices.finalizeInvoice(invoice.id);

      const { data: invoiceRow, error: insErr } = await admin.from('billing_invoices').insert({
        org_id: batch.org_id,
        stripe_invoice_id: finalized.id,
        period_start: batch.period_start,
        period_end: batch.period_end,
        status: finalized.status ?? 'open',
        subtotal_cents: batch.subtotal_cents,
        dispute_count: batch.dispute_count,
        hosted_invoice_url: finalized.hosted_invoice_url ?? null,
        finalized_at: new Date().toISOString(),
      }).select('invoice_id').single();
      if (insErr || !invoiceRow) throw new Error(insErr?.message ?? 'failed to record billing_invoices row');

      await admin.from('underpayment_disputes')
        .update({ billing_invoice_id: invoiceRow.invoice_id })
        .in('dispute_id', batch.line_items.map((li) => li.dispute_id));

      await admin.from('ops_events').insert([{
        event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(),
        kind: 'invoice_created', actor: 'system:stripe-billing-rollup',
        summary: `Invoice created for org ${batch.org_id}: ${batch.dispute_count} disputes, $${(batch.subtotal_cents / 100).toFixed(2)}`,
        payload: { org_id: batch.org_id, stripe_invoice_id: finalized.id, subtotal_cents: batch.subtotal_cents, dispute_count: batch.dispute_count },
      }] as never);

      orgsBilled += 1;
    } catch (e) {
      errors.push({ org_id: batch.org_id, error: (e as Error).message });
    }
  }

  return json({ ok: errors.length === 0, orgs_billed: orgsBilled, errors });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
