import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { getAal, listVerifiedTotpFactors } from '@/lib/mfa';
import { MfaChallenge } from './MfaChallenge';
import { supabase } from '@/integrations/supabase/client';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [mfaState, setMfaState] = useState<'checking' | 'clear' | { factorId: string }>('checking');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function check() {
      const aal = await getAal();
      if (aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        const factors = await listVerifiedTotpFactors();
        if (!cancelled) setMfaState(factors[0] ? { factorId: factors[0].id } : 'clear');
      } else if (!cancelled) {
        setMfaState('clear');
      }
    }
    void check();

    // Re-check on sign-in and after a successful MFA challenge (Supabase
    // fires MFA_CHALLENGE_VERIFIED once the session is promoted to aal2).
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'MFA_CHALLENGE_VERIFIED' || event === 'SIGNED_IN') void check();
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [user]);

  if (loading || (user && mfaState === 'checking')) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading session…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (typeof mfaState === 'object') {
    return <MfaChallenge factorId={mfaState.factorId} onVerified={() => setMfaState('clear')} />;
  }
  return <>{children}</>;
}
