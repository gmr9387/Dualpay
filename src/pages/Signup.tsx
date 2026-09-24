import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';

/**
 * Open signup is disabled for pilot hardening.  Provisioning is done by
 * an org owner/admin via invitation.  Kept as a route so any stale link
 * lands on a clear, branded explanation instead of a 404.
 */
export default function Signup() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-5">
          <div className="h-9 w-9 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-bold">Invite-only access</div>
            <div className="text-[11px] text-muted-foreground font-mono">Self-signup is disabled</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          DualPay accounts are provisioned by your organization administrator.
          Please contact them to receive an invitation.
        </p>
        <div className="mt-4 text-center text-xs text-muted-foreground">
          <Link to="/login" className="text-primary font-medium">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
