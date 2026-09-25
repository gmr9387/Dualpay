import { useState } from 'react';
import { enrollTotp, verifyEnrollment, type EnrollResult } from '@/lib/mfa';
import { Loader2, ShieldCheck } from 'lucide-react';

export function MfaEnroll({ onEnrolled, friendlyName }: { onEnrolled: () => void; friendlyName?: string }) {
  const [enrollment, setEnrollment] = useState<EnrollResult | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true); setError(null);
    const res = await enrollTotp(friendlyName);
    setBusy(false);
    if ('error' in res) { setError(res.error); return; }
    setEnrollment(res);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollment || code.length < 6) return;
    setBusy(true); setError(null);
    const res = await verifyEnrollment(enrollment.factorId, code);
    setBusy(false);
    if ('error' in res) { setError(res.error); return; }
    onEnrolled();
  }

  if (!enrollment) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Set up an authenticator app (Google Authenticator, 1Password, Authy) to generate sign-in codes.
        </p>
        {error && <div className="text-xs text-status-denied">{error}</div>}
        <button onClick={start} disabled={busy}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60 inline-flex items-center gap-2">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          Start setup
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <div className="flex flex-col items-center gap-2 py-2">
        <img src={enrollment.qrCodeDataUri} alt="Scan with your authenticator app" className="h-40 w-40 rounded-md border bg-white p-2" />
        <div className="text-[11px] text-muted-foreground text-center">
          Can't scan? Enter this code manually:
          <div className="font-mono text-[12px] mt-1 select-all">{enrollment.secret}</div>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium">6-digit code from your app</label>
        <input
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoFocus
          placeholder="000000"
          className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm font-mono tracking-widest"
        />
      </div>
      {error && <div className="text-xs text-status-denied">{error}</div>}
      <button type="submit" disabled={busy || code.length < 6}
        className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
        {busy ? 'Verifying…' : 'Verify and enable'}
      </button>
    </form>
  );
}
