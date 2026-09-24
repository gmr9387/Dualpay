import { Link } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/hooks/use-org';
import { useAuth } from '@/hooks/use-auth';
import { RequireRole } from '@/components/auth/RequireRole';
import { toast } from '@/hooks/use-toast';
import { Shield, ScrollText, Database, Users, FileDown, UserPlus, RefreshCw, Trash2, Loader2 } from 'lucide-react';

interface Kpis {
  members: number;
  orgs: number;
  auditEvents: number;
  exports: number;
  storageDocs: number;
}

interface Member {
  user_id: string;
  role: string;
  email: string | null;
  invited_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  expires_at: string | null;
}

const ROLE_OPTIONS = ['admin', 'manager', 'analyst', 'viewer'] as const;

export default function AdminConsole() {
  return (
    <RequireRole min="admin">
      <AdminConsoleInner />
    </RequireRole>
  );
}

function AdminConsoleInner() {
  const { currentOrg } = useOrg();
  const { user } = useAuth();
  const [kpis, setKpis] = useState<Kpis | null>(null);

  useEffect(() => {
    if (!currentOrg) return;
    (async () => {
      const [m, o, e, x, d] = await Promise.all([
        supabase.from('organization_members').select('*', { count: 'exact', head: true }).eq('org_id', currentOrg.org_id),
        supabase.from('organizations').select('*', { count: 'exact', head: true }),
        supabase.from('ops_events').select('*', { count: 'exact', head: true }).eq('org_id', currentOrg.org_id),
        supabase.from('ops_events').select('*', { count: 'exact', head: true }).eq('org_id', currentOrg.org_id).eq('kind', 'audit_export_completed'),
        supabase.from('evidence_documents').select('*', { count: 'exact', head: true }).eq('org_id', currentOrg.org_id),
      ]);
      setKpis({
        members: m.count ?? 0,
        orgs: o.count ?? 0,
        auditEvents: e.count ?? 0,
        exports: x.count ?? 0,
        storageDocs: d.count ?? 0,
      });
    })();
  }, [currentOrg]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin Console</h1>
        <p className="text-sm text-muted-foreground">Tenancy, security, and audit oversight for {currentOrg?.name}.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Kpi icon={<Users className="h-4 w-4" />} label="Active members" value={kpis?.members ?? '—'} />
        <Kpi icon={<Database className="h-4 w-4" />} label="Organizations" value={kpis?.orgs ?? '—'} />
        <Kpi icon={<ScrollText className="h-4 w-4" />} label="Audit events" value={kpis?.auditEvents ?? '—'} />
        <Kpi icon={<FileDown className="h-4 w-4" />} label="Exports run" value={kpis?.exports ?? '—'} />
        <Kpi icon={<Shield className="h-4 w-4" />} label="Stored documents" value={kpis?.storageDocs ?? '—'} />
      </div>

      {currentOrg && <MembersPanel orgId={currentOrg.org_id} selfUserId={user?.id ?? ''} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Security Inventory</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <p className="text-muted-foreground">Inspect Row Level Security policies, helper functions, and role scope.</p>
            <Link className="text-primary underline" to="/admin/security">Open security inventory →</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Audit Export</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <p className="text-muted-foreground">Export ops events, escalations, assignments, outcomes, and evidence activity. Full or PHI-redacted.</p>
            <Link className="text-primary underline" to="/admin/audit">Open audit export →</Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MembersPanel({ orgId, selfUserId }: { orgId: string; selfUserId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]>('analyst');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('invite-member', {
      body: { action: 'list', org_id: orgId },
    });
    if (error) {
      toast({ title: 'Failed to load members', description: error.message, variant: 'destructive' });
      setMembers([]);
    } else {
      setMembers((data as { members?: Member[] })?.members ?? []);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  async function invite(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email) return;
    setBusy('invite');
    const { data, error } = await supabase.functions.invoke('invite-member', {
      body: {
        action: 'invite',
        org_id: orgId,
        email: email.trim(),
        role,
        expires_at: expiresAt || null,
        redirect_to: `${window.location.origin}/reset-password`,
      },
    });
    setBusy(null);
    if (error || (data as { error?: string })?.error) {
      toast({ title: 'Invite failed', description: error?.message ?? (data as { error?: string })?.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Invite sent', description: `${email} · ${role}${expiresAt ? ` · expires ${new Date(expiresAt).toLocaleDateString()}` : ''}` });
    setEmail('');
    setExpiresAt('');
    void load();
  }

  async function setMemberExpiry(m: Member, value: string) {
    setBusy(m.user_id);
    const { error } = await supabase.functions.invoke('invite-member', {
      body: { action: 'set_expiry', org_id: orgId, user_id: m.user_id, expires_at: value || null },
    });
    setBusy(null);
    if (error) { toast({ title: 'Update failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: value ? 'Expiry set' : 'Expiry cleared', description: m.email ?? m.user_id.slice(0, 8) });
    void load();
  }

  async function resend(m: Member) {
    if (!m.email) return;
    setBusy(m.user_id);
    const { error } = await supabase.functions.invoke('invite-member', {
      body: { action: 'resend', org_id: orgId, email: m.email, role: m.role, redirect_to: `${window.location.origin}/reset-password` },
    });
    setBusy(null);
    if (error) { toast({ title: 'Resend failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Invite resent', description: m.email });
  }

  async function remove(m: Member) {
    if (m.user_id === selfUserId) { toast({ title: 'Cannot remove yourself', variant: 'destructive' }); return; }
    if (!confirm(`Remove ${m.email ?? m.user_id.slice(0, 8)} from this organization?`)) return;
    setBusy(m.user_id);
    const { error } = await supabase.functions.invoke('invite-member', {
      body: { action: 'remove', org_id: orgId, user_id: m.user_id },
    });
    setBusy(null);
    if (error) { toast({ title: 'Remove failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Member removed' });
    void load();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Team Members</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[220px]">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1 block">Email</label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="colleague@clinic.com" required />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1 block">Role</label>
            <select value={role} onChange={e => setRole(e.target.value as typeof role)} className="h-9 px-2 rounded-md border bg-background text-sm">
              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1 block">Expires (optional)</label>
            <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
              className="h-9 px-2 rounded-md border bg-background text-sm" title="Leave blank for standing access -- use for contractors or time-bound access" />
          </div>
          <Button type="submit" disabled={busy === 'invite' || !email}>
            {busy === 'invite' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <UserPlus className="h-3.5 w-3.5 mr-1.5" />}
            Send invite
          </Button>
        </form>

        <div className="border rounded">
          <div className="grid grid-cols-[1fr_100px_120px_120px_150px_100px] gap-3 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b">
            <span>Member</span><span>Role</span><span>Invited</span><span>Last sign-in</span><span>Expires</span><span className="text-right">Actions</span>
          </div>
          {loading ? (
            <div className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading members…</div>
          ) : members.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No members yet.</div>
          ) : members.map(m => {
            const isExpired = !!m.expires_at && new Date(m.expires_at).getTime() <= Date.now();
            return (
              <div key={m.user_id} className={`grid grid-cols-[1fr_100px_120px_120px_150px_100px] gap-3 items-center px-3 py-2 text-sm border-b last:border-b-0 ${isExpired ? 'bg-status-denied/5' : ''}`}>
                <div className="min-w-0">
                  <div className="truncate text-foreground">{m.email ?? m.user_id.slice(0, 8)}{m.user_id === selfUserId && <span className="ml-1 text-[10px] uppercase text-muted-foreground">(you)</span>}</div>
                  <div className="text-[10.5px] font-mono text-muted-foreground truncate">{m.user_id}</div>
                </div>
                <span className="text-[11.5px] font-mono uppercase tracking-wider text-muted-foreground">{m.role}</span>
                <span className="text-[11.5px] text-muted-foreground">{m.invited_at ? new Date(m.invited_at).toLocaleDateString() : '—'}</span>
                <span className="text-[11.5px] text-muted-foreground">{m.last_sign_in_at ? new Date(m.last_sign_in_at).toLocaleDateString() : 'never'}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    defaultValue={m.expires_at ? m.expires_at.slice(0, 10) : ''}
                    onBlur={e => { if (e.target.value !== (m.expires_at?.slice(0, 10) ?? '')) void setMemberExpiry(m, e.target.value); }}
                    disabled={busy === m.user_id || m.user_id === selfUserId}
                    className={`h-7 px-1.5 text-[11px] rounded border bg-background w-full ${isExpired ? 'border-status-denied text-status-denied' : ''}`}
                    title={isExpired ? 'Access expired -- RLS denies this member until cleared or extended' : 'Set an expiry for time-bound access; blank = standing access'}
                  />
                </div>
                <div className="flex justify-end gap-1">
                  {!m.last_sign_in_at && m.email && (
                    <Button variant="ghost" size="sm" onClick={() => resend(m)} disabled={busy === m.user_id} title="Resend invite">
                      <RefreshCw className={`h-3.5 w-3.5 ${busy === m.user_id ? 'animate-spin' : ''}`} />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => remove(m)} disabled={busy === m.user_id || m.user_id === selfUserId} title="Remove">
                    <Trash2 className="h-3.5 w-3.5 text-status-denied" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Invited users receive an email from Lovable Cloud, set their password, and are placed directly into this organization with the chosen role.
          Set an expiry for contractor or temporary access -- once it passes, access is denied immediately (enforced at the database level, not just hidden in the UI) and the row is purged the following night.
        </p>
      </CardContent>
    </Card>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">{icon}{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
