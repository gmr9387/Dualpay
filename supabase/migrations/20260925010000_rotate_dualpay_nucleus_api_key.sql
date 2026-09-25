-- Rotates the dualpay api_clients key_hash to a freshly generated key,
-- matching manage-api-clients' own "rotate" action algorithm exactly
-- (vnk_<client_id>_<32 random bytes base64url> -> SHA-256 hex). The
-- plaintext value is handed to the operator once, outside this
-- migration file, and is never stored here or anywhere else in the
-- database -- same "never store plaintext" contract as the rest of
-- this project. This closes the half of the NUCLEUS_API_KEY gap that
-- lives in the database; the other half (setting the matching plaintext
-- as the NUCLEUS_API_KEY Edge Function secret on DualPay's 3
-- nucleus-proxy functions) has to happen via `supabase secrets set`,
-- which no available tool can do on the operator's behalf.
UPDATE public.api_clients
SET key_hash = '8c13539ff8afa94dbd4b324d4e05074071a395072977e07f2d4bc9fe4eb88d9c'
WHERE client_id = 'dualpay';
