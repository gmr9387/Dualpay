import { useEffect, useState, useCallback } from 'react';
import {
  listContracts, listFeeSchedules, listDisputes, CONTRACT_EVENT,
} from '@/lib/contracts';
import type { PayerContract, FeeScheduleRow, UnderpaymentDispute, DisputeDirection } from '@/types/contracts';

export function useContracts() {
  const [contracts, setContracts] = useState<PayerContract[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    listContracts().then(c => { setContracts(c); setLoading(false); });
  }, []);
  useEffect(() => {
    reload();
    const h = () => reload();
    window.addEventListener(CONTRACT_EVENT, h);
    return () => window.removeEventListener(CONTRACT_EVENT, h);
  }, [reload]);
  return { contracts, loading, reload };
}

export function useFeeSchedules(contract_id: string | undefined) {
  const [rows, setRows] = useState<FeeScheduleRow[]>([]);
  useEffect(() => {
    if (!contract_id) { setRows([]); return; }
    listFeeSchedules(contract_id).then(setRows);
  }, [contract_id]);
  return rows;
}

/**
 * Optional `direction` filters server-side (org_id, direction, created_at)
 * so pages scoped to one direction -- Contract Recovery (underpayment),
 * Payer Findings (overpayment) -- fetch and sort only their own rows
 * instead of pulling the whole org's disputes table and filtering in JS.
 * Callers that need everything (ContractsHome, ContractAnalytics,
 * job-runner) omit it and keep today's unfiltered behavior.
 */
export function useDisputes(direction?: DisputeDirection) {
  const [disputes, setDisputes] = useState<UnderpaymentDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    listDisputes(direction).then(d => { setDisputes(d); setLoading(false); });
  }, [direction]);
  useEffect(() => {
    reload();
    const h = () => reload();
    window.addEventListener(CONTRACT_EVENT, h);
    return () => window.removeEventListener(CONTRACT_EVENT, h);
  }, [reload]);
  return { disputes, loading, reload };
}
