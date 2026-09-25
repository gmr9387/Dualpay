import { ReactNode, useEffect, useState } from 'react';
import { useOrg } from '@/hooks/use-org';
import { listVerifiedTotpFactors } from '@/lib/mfa';
import { MfaEnroll } from './MfaEnroll';
import { Shield } from 'lucide-react';

const ELEVATED_ROLES = new Set(['owner', 'admin']);

/**
 * RISK_REGISTER #6: MFA not enforced for admin/owner roles. Blocks access
 * to the app shell for owner/admin members with zero verified TOTP factors
 * until they enroll one -- can't be dismissed or skipped. Lower roles are
 * unaffected here; they can still opt in voluntarily via AccountSecurity.
 */
export function EnforceMfaForElevatedRoles({ children }: { children: ReactNode }) {
  const { currentOrg, loading: orgLoading } = useOrg();
  const [status, setStatus] = useState<'checking' | 'ok' | 'must-enroll'>('checking');

  useEffect(() => {
    if (orgLoading) return;
    if (!currentOrg || !ELEVATED_ROLES.has(currentOrg.role)) { setStatus('ok'); return; }
    let cancelled = false;
    listVerifiedTotpFactors().then(factors => {
      if (!cancelled) setStatus(factors.length > 0 ? 'ok' : 'must-enroll');
    });
    return () => { cancelled = true; };
  }, [orgLoading, currentOrg]);

  if (orgLoading || status === 'checking') {
    return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (status === 'must-enroll') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4">
        <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-sm font-bold">Multi-factor authentication required</div>
              <div className="text-[11px] text-muted-foreground font-mono">
                {currentOrg?.role} accounts must enroll before continuing
              </div>
            </div>
          </div>
          <MfaEnroll onEnrolled={() => setStatus('ok')} friendlyName={`${currentOrg?.role}-required`} />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
