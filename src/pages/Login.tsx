import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Shield } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const { user } = useAuth();

  useEffect(() => {
    if (user) nav((loc.state?.from as string) || '/', { replace: true });
  }, [user, nav, loc.state]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    nav((loc.state?.from as string) || '/', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-5">
          <div className="h-9 w-9 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-bold">DualPay</div>
            <div className="text-[11px] text-muted-foreground font-mono">Sign in to continue</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-medium">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium">Password</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
              className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" />
          </div>
          {err && <div className="text-xs text-status-denied">{err}</div>}
          <button type="submit" disabled={busy}
            className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="mt-4 text-center text-xs text-muted-foreground space-y-1">
          <div><Link to="/forgot-password" className="text-primary font-medium">Forgot password?</Link></div>
          <div className="text-muted-foreground/70">Access is invite-only. Contact your administrator to be added.</div>
        </div>
      </div>
    </div>
  );
}
