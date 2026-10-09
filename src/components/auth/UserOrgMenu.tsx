import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { useOrg } from '@/hooks/use-org';
import { toast } from '@/hooks/use-toast';
import { uploadAvatar } from '@/lib/avatar';
import { User, LogOut, Building2, ChevronDown, Plus, Shield, AlertCircle, Camera } from 'lucide-react';

export function UserOrgMenu() {
  const { user, signOut } = useAuth();
  const { orgs, currentOrg, selectOrg, createOrg } = useOrg();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file || !user) return;
    setAvatarBusy(true);
    const { error } = await uploadAvatar(user.id, file);
    setAvatarBusy(false);
    if (error) {
      toast({ title: 'Could not update profile picture', description: error, variant: 'destructive' });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreateError(null);
    const { org, error } = await createOrg(newName.trim());
    if (error) {
      setCreateError(error);
      toast({ title: 'Could not create organization', description: error, variant: 'destructive' });
      return;
    }
    if (org) { setNewName(''); setCreating(false); setOpen(false); }
  };

  return (
    <div className="relative flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={avatarBusy}
        title="Change profile picture"
        className="group relative h-7 w-7 shrink-0 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden disabled:opacity-60"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <User className="h-3.5 w-3.5 text-primary" />
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
          <Camera className="h-3 w-3 text-white" />
        </span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleAvatarChange}
      />

      <button onClick={() => setOpen(v => !v)} className="flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-muted">
        <div className="text-left leading-tight hidden md:block">
          <div className="text-[11px] font-semibold truncate max-w-[140px]">{currentOrg?.name ?? 'No org'}</div>
          <div className="text-[9.5px] text-muted-foreground font-mono truncate max-w-[140px]">{user?.email}</div>
        </div>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 rounded-md border bg-card shadow-lg z-50 p-2">
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Organization</div>
          {orgs.length === 0 && (
            <div className="px-2 py-2 text-xs text-muted-foreground">No organizations yet.</div>
          )}
          {orgs.map(o => (
            <button key={o.org_id} onClick={() => { selectOrg(o.org_id); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left hover:bg-muted ${
                currentOrg?.org_id === o.org_id ? 'bg-muted font-semibold' : ''
              }`}>
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1 truncate">{o.name}</span>
              <span className="text-[9.5px] font-mono uppercase text-primary">{o.role}</span>
            </button>
          ))}
          {!creating ? (
            <button onClick={() => setCreating(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-primary hover:bg-muted">
              <Plus className="h-3.5 w-3.5" /> New organization
            </button>
          ) : (
            <form onSubmit={handleCreate} className="px-2 py-1.5 space-y-1.5">
              <div className="flex gap-1">
                <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="Org name"
                  className="flex-1 h-7 px-2 text-xs rounded border bg-background" />
                <button type="submit" className="h-7 px-2 rounded bg-primary text-primary-foreground text-xs">Add</button>
              </div>
              {createError && (
                <div className="flex items-start gap-1 rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[10.5px] text-destructive">
                  <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                  <span>{createError}</span>
                </div>
              )}
            </form>
          )}
          <div className="border-t my-1.5" />
          <Link to="/account/security" onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left hover:bg-muted">
            <Shield className="h-3.5 w-3.5 text-muted-foreground" /> Account security
          </Link>
          <button onClick={signOut}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left hover:bg-muted">
            <LogOut className="h-3.5 w-3.5 text-muted-foreground" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function NoOrgEmptyState() {
  const { createOrg } = useOrg();
  const [name, setName] = useState('My Organization');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await createOrg(name.trim() || 'My Organization');
    if (err) setError(err);
    setBusy(false);
  };
  return (
    <div className="h-full w-full flex items-center justify-center p-8">
      <form onSubmit={submit} className="max-w-sm w-full rounded-lg border bg-card p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <div className="text-sm font-bold">Create your organization</div>
        </div>
        <p className="text-xs text-muted-foreground">
          DualPay scopes all data by organization. Create one to continue.
        </p>
        <input value={name} onChange={e => setName(e.target.value)}
          className="w-full h-9 px-3 rounded-md border bg-background text-sm" />
        {error && (
          <div className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11.5px] text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <button type="submit" disabled={busy}
          className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
          {busy ? 'Creating…' : 'Create organization'}
        </button>
      </form>
    </div>
  );
}
