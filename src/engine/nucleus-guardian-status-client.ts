/**
 * Client for the nucleus-guardian-status Edge Function (supabase/
 * functions/nucleus-guardian-status/) -- the server-side proxy that
 * holds nucleus's API key and forwards a read-only safety check to
 * valtaris-nucleus's real Guardian kill switch.
 *
 * This is a new, additive capability: calling it does not gate
 * anything in this repo today. No claim-submission or automation path
 * checks it. Wiring a real gate to it is a separate, deliberate
 * decision -- same rationale as nucleus-adjudication-client.ts's and
 * nucleus-weaver-client.ts's headers.
 *
 * Returns `configured: false` (not a thrown error) when the Edge
 * Function reports NUCLEUS_GUARDIAN_STATUS_URL/NUCLEUS_API_KEY aren't
 * set yet, so callers can distinguish "not wired up" from "nucleus
 * said unsafe."
 */
import { supabase } from '@/integrations/supabase/client';

export interface NucleusGuardianStatusResult {
  configured: true;
  safe_to_process: boolean;
  kill_switch_active: boolean | null;
  reason: string | null;
  activated_by: string | null;
  kill_switch_updated_at: string | null;
  timestamp: string;
}

export interface NucleusGuardianStatusNotConfigured {
  configured: false;
  error: string;
}

export async function checkNucleusGuardianStatus(): Promise<
  NucleusGuardianStatusResult | NucleusGuardianStatusNotConfigured
> {
  const { data, error } = await supabase.functions.invoke('nucleus-guardian-status');

  if (error) {
    // The proxy returns HTTP 501 with a clear message when nucleus's
    // secrets aren't configured yet -- surface that distinctly rather
    // than as a generic failure.
    const context = (error as { context?: { status?: number } }).context;
    if (context?.status === 501) {
      return { configured: false, error: error.message };
    }
    throw new Error(`Nucleus Guardian status check failed: ${error.message}`);
  }

  return { configured: true, ...(data as Omit<NucleusGuardianStatusResult, 'configured'>) };
}
