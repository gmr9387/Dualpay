import { useEffect, useState } from 'react';
import {
  loadAllAssignments, getAllAssignments, setAssignment, unassignClaim, normalizeAssignee,
  _setCache, type Assignment, type WorkingStatus,
  loadOrgAssignees, type OrgAssignee,
} from '@/lib/assignments';
import { migrateLocalStorageOnce } from '@/lib/persistence-migration';
import { useOrg } from '@/hooks/use-org';

export function useAssignments() {
  const { currentOrg } = useOrg();
  const [store, setStore] = useState<Record<string, Assignment>>(() => getAllAssignments());
  const [assignees, setAssignees] = useState<OrgAssignee[]>([]);

  useEffect(() => {
    let alive = true;
    const sync = () => {
      loadAllAssignments().then(next => {
        if (!alive) return;
        _setCache(next);
        setStore(next);
      }).catch(() => {});
    };
    migrateLocalStorageOnce().finally(sync);
    window.addEventListener('clarity-assignments', sync);
    return () => { alive = false; window.removeEventListener('clarity-assignments', sync); };
  }, []);

  useEffect(() => {
    if (!currentOrg) { setAssignees([]); return; }
    loadOrgAssignees(currentOrg.org_id).then(setAssignees).catch(() => setAssignees([]));
  }, [currentOrg]);

  return {
    store,
    get: (id: string): Assignment => store[id] ?? { claim_id: id, assignee: null, status: 'open' as WorkingStatus, updated_at: '' },
    /**
     * Assign a claim. Pass a user id to assign, or `null` / `undefined` / empty string
     * to explicitly unassign (persisted as `NULL`, never `undefined`).
     */
    assign: (id: string, assignee: string | null | undefined) => {
      void setAssignment(id, { assignee: normalizeAssignee(assignee) });
    },
    /** Explicit unassign — always persists `assignee = NULL`. */
    unassign: (id: string) => { void unassignClaim(id); },
    setStatus: (id: string, status: WorkingStatus) => { void setAssignment(id, { status }); },
    /** Real org members (UUID + display name). Empty until org loads. */
    assignees,
  };
}
