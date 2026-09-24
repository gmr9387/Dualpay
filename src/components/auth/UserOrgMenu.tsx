import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useOrg } from '@/hooks/use-org';
import { User, LogOut, Building2, ChevronDown, Plus } from 'lucide-react';

export function UserOrgMenu() {
  const { user, signOut } = useAuth();
  const { orgs, currentOrg, selectOrg, createOrg } = useOrg();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await createOrg(newName.trim());
    setNewName(''); setCreating(false); setOpen(false);
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted">
        <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
          <User className="h-3.5 w-3.5 text-primary" />
        </div>
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
            <form onSubmit={handleCreate} className="px-2 py-1.5 flex gap-1">
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Org name"
                className="flex-1 h-7 px-2 text-xs rounded border bg-background" />
              <button type="submit" className="h-7 px-2 rounded bg-primary text-primary-foreground text-xs">Add</button>
            </form>
          )}
          <div className="border-t my-1.5" />
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
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await createOrg(name.trim() || 'My Organization');
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
        <button type="submit" disabled={busy}
          className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
          {busy ? 'Creating…' : 'Create organization'}
        </button>
      </form>
    </div>
  );
}
