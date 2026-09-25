import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { unenrollFactor } from '@/lib/mfa';
import { MfaEnroll } from '@/components/auth/MfaEnroll';
import { Shield, Trash2, ShieldCheck } from 'lucide-react';

interface Factor { id: string; friendly_name: string | null; status: 'verified' | 'unverified'; created_at: string }

export default function AccountSecurity() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function remove(id: string) {
    if (!confirm('Remove this authenticator? You will need to re-enroll to use MFA again.')) return;
    setBusy(id);
    const res = await unenrollFactor(id);
    setBusy(null);
    if ('error' in res) { alert(res.error); return; }
    void load();
  }

  const verified = factors.filter(f => f.status === 'verified');

  return (
    <div className="p-6 space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-semibold">Account Security</h1>
        <p className="text-sm text-muted-foreground">Manage multi-factor authentication for your account.</p>
      </div>

      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Authenticator apps</span>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : verified.length === 0 && !adding ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No authenticator enrolled. Admin and owner accounts are required to enroll one.</p>
            <button onClick={() => setAdding(true)} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium">
              Add authenticator app
            </button>
          </div>
        ) : adding ? (
          <MfaEnroll onEnrolled={() => { setAdding(false); void load(); }} />
        ) : (
          <div className="space-y-2">
            {verified.map(f => (
              <div key={f.id} className="flex items-center justify-between px-3 py-2 rounded-md border">
                <div className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="h-4 w-4 text-status-paid" />
                  <span>{f.friendly_name || 'Authenticator'}</span>
                </div>
                <button onClick={() => remove(f.id)} disabled={busy === f.id}
                  className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-status-denied">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
