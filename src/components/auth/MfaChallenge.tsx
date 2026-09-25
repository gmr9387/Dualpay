import { useState } from 'react';
import { verifyLoginChallenge } from '@/lib/mfa';
import { Shield } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

export function MfaChallenge({ factorId, onVerified }: { factorId: string; onVerified: () => void }) {
  const { signOut } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length < 6) return;
    setBusy(true); setError(null);
    const res = await verifyLoginChallenge(factorId, code);
    setBusy(false);
    if ('error' in res) { setError(res.error); return; }
    onVerified();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-5">
          <div className="h-9 w-9 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-bold">Verification required</div>
            <div className="text-[11px] text-muted-foreground font-mono">Enter your authenticator code</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoFocus
            placeholder="000000"
            className="w-full h-9 px-3 rounded-md border bg-background text-sm font-mono tracking-widest text-center"
          />
          {error && <div className="text-xs text-status-denied">{error}</div>}
          <button type="submit" disabled={busy || code.length < 6}
            className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
            {busy ? 'Verifying…' : 'Verify'}
          </button>
        </form>
        <button onClick={signOut} className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground">
          Sign out
        </button>
      </div>
    </div>
  );
}
