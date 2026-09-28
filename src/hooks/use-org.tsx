import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './use-auth';

export type OrgRole = 'owner' | 'admin' | 'manager' | 'analyst' | 'viewer';

export interface Org {
  org_id: string;
  name: string;
  role: OrgRole;
  /** Contingency fee (basis points) assessed on a recovered underpayment dispute. 0 = unconfigured. */
  recovery_fee_percent_bps: number;
  stripe_customer_id: string | null;
  ach_connected_at: string | null;
}

export interface CreateOrgResult {
  org: Org | null;
  /** Human-readable reason when org is null -- surfaced to the UI instead of only console.error'd. */
  error: string | null;
}

interface OrgCtx {
  orgs: Org[];
  currentOrg: Org | null;
  loading: boolean;
  selectOrg: (id: string) => void;
  refresh: () => Promise<void>;
  createOrg: (name: string) => Promise<CreateOrgResult>;
  setRecoveryFeePercent: (bps: number) => Promise<boolean>;
}

const STORAGE_KEY = 'clarity:current_org_id';
const Ctx = createContext<OrgCtx>({
  orgs: [], currentOrg: null, loading: true,
  selectOrg: () => {}, refresh: async () => {}, createOrg: async () => ({ org: null, error: 'Not initialized' }),
  setRecoveryFeePercent: async () => false,
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
      .select('role, org_id, organizations(name, org_id, recovery_fee_percent_bps, stripe_customer_id, ach_connected_at)')
      .eq('user_id', user.id);
    if (error) { console.error('[org] load failed', error.message); setLoading(false); return; }
    const list: Org[] = (data ?? []).map((r) => ({
      org_id: r.org_id,
      name: r.organizations?.name ?? 'Untitled Org',
      role: r.role as OrgRole,
      recovery_fee_percent_bps: r.organizations?.recovery_fee_percent_bps ?? 0,
      stripe_customer_id: r.organizations?.stripe_customer_id ?? null,
      ach_connected_at: r.organizations?.ach_connected_at ?? null,
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

  const createOrg = async (name: string): Promise<CreateOrgResult> => {
    if (!user) return { org: null, error: 'Not signed in.' };
    // Insert with a client-generated org_id and no .select() — the
    // organizations SELECT policy requires org membership, which doesn't
    // exist yet at insert time, so a chained .select().single() here gets
    // zero rows back under RLS and throws. Insert the membership row first
    // (satisfies the org_has_no_members bootstrap clause), then read the
    // org back once membership actually exists.
    const orgId = crypto.randomUUID();
    const { error: orgErr } = await supabase
      .from('organizations').insert({ org_id: orgId, name });
    if (orgErr) {
      console.error('[org] create failed', orgErr.message);
      return { org: null, error: `Couldn't create organization: ${orgErr.message}` };
    }
    const { error: mErr } = await supabase
      .from('organization_members')
      .insert({ org_id: orgId, user_id: user.id, role: 'owner' });
    if (mErr) {
      console.error('[org] membership failed', mErr.message);
      return { org: null, error: `Organization created, but membership setup failed: ${mErr.message}` };
    }
    const { data: org, error: fetchErr } = await supabase
      .from('organizations').select('*').eq('org_id', orgId).single();
    if (fetchErr || !org) {
      console.error('[org] fetch after create failed', fetchErr?.message);
      return { org: null, error: `Organization created, but couldn't load it back: ${fetchErr?.message ?? 'unknown error'}` };
    }
    await refresh();
    selectOrg(org.org_id);
    return {
      org: {
        org_id: org.org_id, name: org.name, role: 'owner',
        recovery_fee_percent_bps: org.recovery_fee_percent_bps ?? 0,
        stripe_customer_id: org.stripe_customer_id ?? null,
        ach_connected_at: org.ach_connected_at ?? null,
      },
      error: null,
    };
  };

  const currentOrg = orgs.find(o => o.org_id === currentOrgId) ?? null;

  const setRecoveryFeePercent = async (bps: number): Promise<boolean> => {
    if (!currentOrg) return false;
    const { error } = await supabase
      .from('organizations')
      .update({ recovery_fee_percent_bps: bps })
      .eq('org_id', currentOrg.org_id);
    if (error) { console.error('[org] set fee percent failed', error.message); return false; }
    await refresh();
    return true;
  };

  return (
    <Ctx.Provider value={{ orgs, currentOrg, loading, selectOrg, refresh, createOrg, setRecoveryFeePercent }}>
      {children}
    </Ctx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOrg() { return useContext(Ctx); }
