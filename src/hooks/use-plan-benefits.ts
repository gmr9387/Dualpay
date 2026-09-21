import { useEffect, useState, useCallback } from 'react';
import { listPlanBenefits, PLAN_BENEFITS_EVENT } from '@/lib/plan-benefits';
import type { PlanBenefitRecord } from '@/types/plan-benefits';

export function usePlanBenefits() {
  const [plans, setPlans] = useState<PlanBenefitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    listPlanBenefits().then(p => { setPlans(p); setLoading(false); });
  }, []);
  useEffect(() => {
    reload();
    const h = () => reload();
    window.addEventListener(PLAN_BENEFITS_EVENT, h);
    return () => window.removeEventListener(PLAN_BENEFITS_EVENT, h);
  }, [reload]);
  return { plans, loading, reload };
}
