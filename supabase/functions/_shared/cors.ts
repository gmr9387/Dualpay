// Canonical CORS headers for Supabase Edge Functions.
// Import this instead of the non-existent `npm:@supabase/supabase-js@2/cors` subpath.
//
// The wildcard origin is intentional: these functions are called either by
// pg_cron (server-to-server, no browser involved) or by the authenticated
// Supabase client using a JWT / service-role key in the Authorization header.
// CORS does not provide a security boundary here — authentication does.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
};
