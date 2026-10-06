/**
 * Multi-factor authentication (TOTP) — RISK_REGISTER #6: MFA was never
 * enforced for admin/owner roles despite Supabase Auth supporting it.
 * Thin wrapper around supabase.auth.mfa.* so the enrollment/challenge UI
 * doesn't call the SDK directly in a dozen places.
 */
import { supabase } from '@/integrations/supabase/client';

/**
 * TEMPORARY, development only: build-time switch that skips the client-side
 * MFA challenge and the admin/owner enrollment gate so a preview can be
 * viewed without a TOTP device. Off unless VITE_DISABLE_MFA is exactly
 * "true". Never set it on a production deployment, and unset it before
 * release -- MFA is enforced again as soon as it is removed.
 */
export const MFA_DISABLED = import.meta.env.VITE_DISABLE_MFA === 'true';
if (MFA_DISABLED) console.warn('[dualpay] VITE_DISABLE_MFA is set: client-side MFA checks are bypassed.');

export interface AalStatus {
  currentLevel: 'aal1' | 'aal2' | null;
  nextLevel: 'aal1' | 'aal2' | null;
}

export async function getAal(): Promise<AalStatus> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return { currentLevel: null, nextLevel: null };
  return { currentLevel: data.currentLevel, nextLevel: data.nextLevel };
}

export interface TotpFactor {
  id: string;
  friendly_name: string | null;
  status: 'verified' | 'unverified';
}

export async function listVerifiedTotpFactors(): Promise<TotpFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return [];
  return data.totp.filter(f => f.status === 'verified');
}

export interface EnrollResult {
  factorId: string;
  qrCodeDataUri: string;
  secret: string;
}

export async function enrollTotp(friendlyName?: string): Promise<EnrollResult | { error: string }> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: friendlyName || `authenticator-${Date.now()}`,
  });
  if (error || !data) return { error: error?.message ?? 'Enrollment failed' };
  // Supabase returns qr_code as a raw SVG string, not a src-ready URI. Encoding
  // it into a data: URI for an <img src> avoids dangerouslySetInnerHTML (banned
  // per RISK_REGISTER #5) while still rendering the actual scannable code.
  const qrCodeDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(data.totp.qr_code)}`;
  return { factorId: data.id, qrCodeDataUri, secret: data.totp.secret };
}

export async function verifyEnrollment(factorId: string, code: string): Promise<{ ok: true } | { error: string }> {
  const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
  if (cErr || !challenge) return { error: cErr?.message ?? 'Could not start verification' };
  const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
  if (vErr) return { error: vErr.message };
  return { ok: true };
}

export async function verifyLoginChallenge(factorId: string, code: string): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function unenrollFactor(factorId: string): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { error: error.message };
  return { ok: true };
}
