import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createPlanBenefit, getPlanBenefit, updatePlanBenefit } from '@/lib/plan-benefits';
import { useAuth } from '@/hooks/use-auth';
import { useOrg } from '@/hooks/use-org';
import { can } from '@/lib/role-permissions';
import type { CoveredService } from '@/types/claim';
import { Upload, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

const dollarsToCents = (v: string): number => Math.round((parseFloat(v) || 0) * 100);
const centsToDollars = (c: number): string => c ? (c / 100).toFixed(2) : '';

export default function PlanBenefitsUpload() {
  const navigate = useNavigate();
  const { planId } = useParams();
  const isEdit = !!planId;
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const allowed = can.upload(currentOrg?.role);

  const [payerName, setPayerName] = useState('');
  const [planName, setPlanName] = useState('');
  const [planYear, setPlanYear] = useState(String(new Date().getFullYear()));
  const [deductibleInd, setDeductibleInd] = useState('');
  const [deductibleFam, setDeductibleFam] = useState('');
  const [oopInd, setOopInd] = useState('');
  const [oopFam, setOopFam] = useState('');
  const [coinsurance, setCoinsurance] = useState('20');
  const [copay, setCopay] = useState('');
  const [cobPolicy, setCobPolicy] = useState('standard');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [terminationDate, setTerminationDate] = useState('');
  const [coveredServicesJson, setCoveredServicesJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(isEdit);
  const [notFound, setNotFound] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; plan_id?: string; error?: string } | null>(null);

  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    getPlanBenefit(planId).then(plan => {
      if (cancelled) return;
      if (!plan) { setNotFound(true); setLoadingExisting(false); return; }
      setPayerName(plan.payer_name);
      setPlanName(plan.plan_name);
      setPlanYear(String(plan.plan_year));
      setDeductibleInd(centsToDollars(plan.deductible_individual));
      setDeductibleFam(centsToDollars(plan.deductible_family));
      setOopInd(centsToDollars(plan.oop_max_individual));
      setOopFam(centsToDollars(plan.oop_max_family));
      setCoinsurance(String(plan.coinsurance_rate * 100));
      setCopay(plan.copay_amount ? centsToDollars(plan.copay_amount) : '');
      setCobPolicy(plan.cob_policy ?? 'standard');
      setEffectiveDate(plan.effective_date.slice(0, 10));
      setTerminationDate(plan.termination_date?.slice(0, 10) ?? '');
      setCoveredServicesJson(plan.covered_services?.length ? JSON.stringify(plan.covered_services, null, 2) : '');
      setLoadingExisting(false);
    });
    return () => { cancelled = true; };
  }, [planId]);

  if (!allowed) {
    return <div className="p-6 text-sm text-muted-foreground">Analyst role or higher required to {isEdit ? 'edit' : 'add'} plan benefits.</div>;
  }

  if (loadingExisting) {
    return <div className="h-full flex items-center justify-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading plan…</div>;
  }

  if (notFound) {
    return <div className="p-6 text-sm text-muted-foreground">Plan not found.</div>;
  }

  const submit = async () => {
    if (!payerName || !planName || !effectiveDate) return;
    setBusy(true);
    let covered_services: CoveredService[] = [];
    if (coveredServicesJson.trim()) {
      try {
        covered_services = JSON.parse(coveredServicesJson);
      } catch {
        setResult({ ok: false, error: 'Covered services JSON is invalid — left blank or fix the syntax.' });
        setBusy(false);
        return;
      }
    }
    const fields = {
      payer_name: payerName,
      plan_name: planName,
      plan_year: parseInt(planYear, 10) || new Date().getFullYear(),
      deductible_individual: dollarsToCents(deductibleInd),
      deductible_family: dollarsToCents(deductibleFam),
      oop_max_individual: dollarsToCents(oopInd),
      oop_max_family: dollarsToCents(oopFam),
      coinsurance_rate: (parseFloat(coinsurance) || 0) / 100,
      copay_amount: copay ? dollarsToCents(copay) : null,
      cob_policy: cobPolicy,
      covered_services,
      effective_date: effectiveDate,
      termination_date: terminationDate || null,
    };
    const plan = isEdit
      ? await updatePlanBenefit(planId, fields)
      : await createPlanBenefit({ ...fields, uploaded_by: user?.email ?? undefined });
    setResult(plan ? { ok: true, plan_id: plan.plan_id } : { ok: false, error: 'Save failed — check console for details.' });
    setBusy(false);
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl space-y-4">
      <header>
        <h1 className="text-xl font-bold">{isEdit ? 'Edit Plan Benefits' : 'Add Plan Benefits'}</h1>
        <p className="text-[12.5px] text-muted-foreground">
          {isEdit
            ? 'Correcting an existing plan in place. This does not create a new version — use Add Plan Benefits for a real plan-year revision.'
            : 'Real, versioned plan benefit data. Once on file for a payer, non-demo claims for that payer are adjudicated against these real terms instead of being skipped.'}
        </p>
      </header>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Payer Name *"><input value={payerName} onChange={e => setPayerName(e.target.value)} className="w-full h-9 px-2 rounded border bg-background text-[13px]" /></Field>
          <Field label="Plan Name *"><input value={planName} onChange={e => setPlanName(e.target.value)} className="w-full h-9 px-2 rounded border bg-background text-[13px]" /></Field>
          <Field label="Plan Year *"><input type="number" value={planYear} onChange={e => setPlanYear(e.target.value)} className="w-full h-9 px-2 rounded border bg-background text-[13px]" /></Field>
          <Field label="COB Policy">
            <select value={cobPolicy} onChange={e => setCobPolicy(e.target.value)} className="w-full h-9 px-2 rounded border bg-background text-[13px]">
              <option value="standard">Standard</option>
              <option value="non_duplication">Non-duplication</option>
              <option value="carve_out">Carve-out</option>
              <option value="maintenance_of_benefits">Maintenance of Benefits</option>
            </select>
          </Field>
          <Field label="Effective Date *"><input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} className="w-full h-9 px-2 rounded border bg-background text-[13px]" /></Field>
          <Field label="Termination Date"><input type="date" value={terminationDate} onChange={e => setTerminationDate(e.target.value)} className="w-full h-9 px-2 rounded border bg-background text-[13px]" /></Field>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-[12.5px] font-semibold">Deductible & Out-of-Pocket ($)</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Deductible — Individual"><input type="number" step="0.01" value={deductibleInd} onChange={e => setDeductibleInd(e.target.value)} className="w-full h-9 px-2 rounded border bg-background text-[13px]" /></Field>
          <Field label="Deductible — Family"><input type="number" step="0.01" value={deductibleFam} onChange={e => setDeductibleFam(e.target.value)} className="w-full h-9 px-2 rounded border bg-background text-[13px]" /></Field>
          <Field label="OOP Max — Individual"><input type="number" step="0.01" value={oopInd} onChange={e => setOopInd(e.target.value)} className="w-full h-9 px-2 rounded border bg-background text-[13px]" /></Field>
          <Field label="OOP Max — Family"><input type="number" step="0.01" value={oopFam} onChange={e => setOopFam(e.target.value)} className="w-full h-9 px-2 rounded border bg-background text-[13px]" /></Field>
          <Field label="Coinsurance (%, member share)"><input type="number" step="0.1" value={coinsurance} onChange={e => setCoinsurance(e.target.value)} className="w-full h-9 px-2 rounded border bg-background text-[13px]" /></Field>
          <Field label="Copay ($, optional)"><input type="number" step="0.01" value={copay} onChange={e => setCopay(e.target.value)} className="w-full h-9 px-2 rounded border bg-background text-[13px]" /></Field>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-2">
        <div className="text-[12.5px] font-semibold">Covered Services (JSON — optional)</div>
        <div className="text-[11px] text-muted-foreground">Array of {'{'}category, procedure_codes, requires_auth{'}'}. Leave blank if not tracking per-service limits yet.</div>
        <textarea value={coveredServicesJson} onChange={e => setCoveredServicesJson(e.target.value)} rows={5}
          placeholder='[{"category":"office_visit","procedure_codes":["99213","99214"],"requires_auth":false}]'
          className="w-full font-mono text-[11px] p-2 rounded border bg-background" />
      </div>

      <div className="flex items-center justify-between">
        <button onClick={submit} disabled={busy || !payerName || !planName}
          className="px-4 py-2 text-[13px] rounded-md bg-primary text-primary-foreground inline-flex items-center gap-2 disabled:opacity-50">
          <Upload className="h-3.5 w-3.5" /> {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Plan'}
        </button>
        {result && (
          <div className="text-[12.5px] flex items-center gap-2">
            {result.ok ? <CheckCircle2 className="h-4 w-4 text-status-paid" /> : <AlertCircle className="h-4 w-4 text-status-denied" />}
            <span>{result.ok ? (isEdit ? 'Changes saved.' : 'Plan saved.') : result.error}</span>
            {result.ok && <button onClick={() => navigate('/plan-benefits')} className="text-primary underline">View plans</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
