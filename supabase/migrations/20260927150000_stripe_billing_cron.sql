-- Monthly Stripe contingency-fee rollup cron.
-- Mirrors glue.dispatch_pending_jobs()'s Vault-secret-gated pg_net dispatch
-- pattern: safely no-ops until dualpay_billing_service_role_key is set in
-- Vault (Project Settings -> Vault in the Supabase dashboard), then fires
-- stripe-billing-rollup on the 1st of every month.

CREATE OR REPLACE FUNCTION dualpay.dispatch_stripe_rollup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'dualpay', 'extensions', 'public'
AS $function$
declare
  v_key text;
  v_url text := 'https://qrqekucwdfyqqzomuble.supabase.co/functions/v1/stripe-billing-rollup';
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'dualpay_billing_service_role_key'
  limit 1;

  if v_key is null then
    raise notice 'dualpay.dispatch_stripe_rollup: dualpay_billing_service_role_key not set in vault, skipping rollup';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb
  );
end;
$function$;

select cron.schedule(
  'stripe-monthly-billing-rollup',
  '0 6 1 * *',
  $$select dualpay.dispatch_stripe_rollup();$$
);
