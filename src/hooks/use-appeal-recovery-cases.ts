import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from './use-org';

export type AppealRecoveryState =
  | 'denied'
  | 'appeal_filed'
  | 'submitted'
  | 'payer_response'
  | 'recovered'
  | 'closed';

export const APPEAL_RECOVERY_STATES: AppealRecoveryState[] = [
  'denied',
  'appeal_filed',
  'submitted',
  'payer_response',
  'recovered',
  'closed',
];

export interface AppealRecoveryCase {
  id: string;
  organization_id: string;
  claim_id: string;
  current_state: AppealRecoveryState;
  assigned_to_user_id: string | null;
  packet_id: string | null;
  core_trace_id: string | null;
  core_decision_outcome: string | null;
  core_dispatch_status: string | null;
  glue_run_id: string | null;
  payer_response_status: string | null;
  recovered_amount_cents: number;
  created_at: string;
  updated_at: string;
}

export type AppealRecoveryCaseInsert = Omit<AppealRecoveryCase, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type AppealRecoveryCaseUpdate = Partial<Omit<AppealRecoveryCase, 'id' | 'organization_id' | 'created_at'>>;

/** Allowed forward/backward state transitions. */
const TRANSITIONS: Record<AppealRecoveryState, AppealRecoveryState[]> = {
  denied:          ['appeal_filed'],
  appeal_filed:    ['submitted', 'denied'],
  submitted:       ['payer_response', 'appeal_filed'],
  payer_response:  ['recovered', 'closed', 'submitted'],
  recovered:       ['closed'],
  closed:          [],
};

export function canTransitionTo(from: AppealRecoveryState, to: AppealRecoveryState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// Table not yet in generated Database types; cast client to bypass type check.
// Remove once `src/integrations/supabase/types.ts` is regenerated with appeal_recovery_cases.
const db = supabase as ReturnType<typeof createClient>;

export function useAppealRecoveryCases() {
  const { currentOrg } = useOrg();
  const [cases, setCases] = useState<AppealRecoveryCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentOrg) { setCases([]); setLoading(false); return; }
    setLoading(true);
    const { data, error: err } = await db
      .from('appeal_recovery_cases')
      .select('*')
      .eq('organization_id', currentOrg.org_id)
      .order('created_at', { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setCases((data ?? []) as AppealRecoveryCase[]);
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { load(); }, [load]);

  const create = useCallback(async (
    claimId: string,
    initial?: Partial<AppealRecoveryCaseInsert>
  ): Promise<AppealRecoveryCase | null> => {
    if (!currentOrg) return null;
    const { data, error: err } = await db
      .from('appeal_recovery_cases')
      .insert({ organization_id: currentOrg.org_id, claim_id: claimId, ...initial })
      .select()
      .single();
    if (err) { setError(err.message); return null; }
    await load();
    return data as AppealRecoveryCase;
  }, [currentOrg, load]);

  const update = useCallback(async (
    id: string,
    patch: AppealRecoveryCaseUpdate
  ): Promise<AppealRecoveryCase | null> => {
    const { data, error: err } = await db
      .from('appeal_recovery_cases')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (err) { setError(err.message); return null; }
    await load();
    return data as AppealRecoveryCase;
  }, [load]);

  const advance = useCallback(async (
    arc: AppealRecoveryCase,
    nextState: AppealRecoveryState,
    idempotencyKey: string,
    extra?: AppealRecoveryCaseUpdate
  ): Promise<AppealRecoveryCase | null> => {
    if (!currentOrg) return null;

    if (!canTransitionTo(arc.current_state, nextState)) {
      setError(`Cannot transition from ${arc.current_state} → ${nextState}`);
      return null;
    }

    if (!idempotencyKey) {
      setError('advance: idempotencyKey is required');
      return null;
    }

    // Phase 4B: route through atomic RPC instead of a bare client-side update.
    const { data: rpcData, error: rpcErr } = await db.rpc('rpc_advance_appeal_case', {
      p_idempotency_key: idempotencyKey,
      p_case_id:         arc.id,
      p_org_id:          currentOrg.org_id,
      p_actor:           arc.assigned_to_user_id ?? 'unknown',
      p_expected_state:  arc.current_state,
      p_next_state:      nextState,
    } as never);

    if (rpcErr) {
      setError(rpcErr.message);
      return null;
    }

    const rpc = rpcData as { already_consumed: boolean; result_id: string; new_state: string };

    // If extra fields need updating (e.g. recovered_amount_cents) apply them via a regular update.
    if (extra && Object.keys(extra).length > 0) {
      const { error: patchErr } = await db
        .from('appeal_recovery_cases')
        .update(extra as never)
        .eq('id', arc.id);
      if (patchErr) console.warn('[advance] extra patch failed', patchErr.message);
    }

    await load();

    // Return the refreshed record; fall back to a synthetic object if load is async.
    const refreshed = cases.find((c) => c.id === arc.id);
    return refreshed ?? { ...arc, current_state: rpc.new_state as AppealRecoveryState };
  }, [currentOrg, cases, load]);

  return { cases, loading, error, reload: load, create, update, advance };
}
