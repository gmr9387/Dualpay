import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './use-auth';

export type OrgRole = 'owner' | 'admin' | 'manager' | 'analyst' | 'viewer';

export interface Org {
  org_id: string;
  name: string;
  role: OrgRole;
}

interface OrgCtx {
  orgs: Org[];
  currentOrg: Org | null;
  loading: boolean;
  selectOrg: (id: string) => void;
  refresh: () => Promise<void>;
  createOrg: (name: string) => Promise<Org | null>;
}

const STORAGE_KEY = 'clarity:current_org_id';
const Ctx = createContext<OrgCtx>({
  orgs: [], currentOrg: null, loading: true,
  selectOrg: () => {}, refresh: async () => {}, createOrg: async () => null,
});

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) { setOrgs([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('organization_members')
      .select('role, org_id, organizations(name, org_id)')
      .eq('user_id', user.id);
    if (error) { console.error('[org] load failed', error.message); setLoading(false); return; }
    const list: Org[] = (data ?? []).map((r: Record<string, unknown>) => ({
      org_id: r.org_id,
      name: r.organizations?.name ?? 'Untitled Org',
      role: r.role as OrgRole,
    }));
    setOrgs(list);
    if (list.length > 0 && (!currentOrgId || !list.find(o => o.org_id === currentOrgId))) {
      const invitedOrgId = (user.user_metadata as { invited_org_id?: string } | null)?.invited_org_id;
      const preferred = (invitedOrgId && list.find(o => o.org_id === invitedOrgId)?.org_id) ?? list[0].org_id;
      setCurrentOrgId(preferred);
      localStorage.setItem(STORAGE_KEY, preferred);
    }
    setLoading(false);
  }, [user, currentOrgId]);

  useEffect(() => { refresh(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectOrg = (id: string) => {
    setCurrentOrgId(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  const createOrg = async (name: string): Promise<Org | null> => {
    if (!user) return null;
    const { data: org, error } = await supabase
      .from('organizations').insert({ name }).select('*').single();
    if (error || !org) { console.error('[org] create failed', error?.message); return null; }
    const { error: mErr } = await supabase
      .from('organization_members')
      .insert({ org_id: org.org_id, user_id: user.id, role: 'owner' });
    if (mErr) { console.error('[org] membership failed', mErr.message); return null; }
    await refresh();
    selectOrg(org.org_id);
    return { org_id: org.org_id, name: org.name, role: 'owner' };
  };

  const currentOrg = orgs.find(o => o.org_id === currentOrgId) ?? null;

  return (
    <Ctx.Provider value={{ orgs, currentOrg, loading, selectOrg, refresh, createOrg }}>
      {children}
    </Ctx.Provider>
  );
}

export function useOrg() { return useContext(Ctx); }
