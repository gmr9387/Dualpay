/**
 * Claims Workbench — refactored from legacy DualPay Index.
 * Provides the deep adjudication / trace / state machine / case view
 * for individual claims as a secondary surface to Claim Clarity.
 */
import { useEffect, useMemo, useState } from 'react';
import { resetIdCounter } from '@/engine/calculation-engine';
import { executeAdjudicationWithReplay } from '@/engine/adjudication-orchestrator';
import { adjudicateViaNucleus } from '@/engine/nucleus-adjudication-client';
import { demoContract, demoPlan, demoPriorOutcomes } from '@/data/demo-scenarios';
import { isDemoModeEnabled } from '@/lib/demo-flag';
import { LIVE_CONTRACT, LIVE_PLAN } from '@/lib/live-stubs';
import { loadLiveContract } from '@/lib/contracts';
import { loadLivePlan } from '@/lib/plan-benefits';
import type { ContractTerms, PlanBenefits } from '@/types/claim';
import {
  loadClaims, loadCases, loadCaseEvents, loadAccumulators, loadLatestRuns,
  saveAdjudication, saveClaim, seedIfEmpty,
} from '@/data/repository';
import type { Claim, AdjudicationRun, MemberAccumulators } from '@/types/claim';
import type { TraceObject } from '@/types/trace';
import type { Case, CaseEvent } from '@/types/case';
import { ClaimList } from '@/components/admin/ClaimList';
import { ClaimOperationsKpis } from '@/components/admin/ClaimOperationsKpis';
import { ClaimWorkspace } from '@/components/admin/ClaimWorkspace';
import { PageHeader, EmptyState } from '@/components/clarity/primitives';
import { Inbox, Loader2 } from 'lucide-react';

interface AdjResult { claimId: string; run: AdjudicationRun; trace: TraceObject; }

interface NucleusGateResult { blocked: boolean; reason?: string; }

/**
 * Real, blocking nucleus check: a deny or critical-risk line stops the
 * claim before the deterministic kernel runs. Nucleus never overrides
 * the kernel's payment math -- it only gates whether that math runs at
 * all, so executeAdjudicationWithReplay's replay/fingerprint guarantee
 * stays intact for every claim that does reach it.
 *
 * Fails open (never blocks) when nucleus isn't configured yet, the
 * claim has no payer_name to check against (claim.intel is populated
 * by Claim Clarity, not always present), or the call itself throws --
 * an infrastructure problem reaching a separate system must not
 * silently halt claims processing.
 */
async function checkNucleusGate(claim: Claim): Promise<NucleusGateResult> {
  const payerName = claim.intel?.payer_name;
  if (!payerName) return { blocked: false };

  try {
    for (const line of claim.lines) {
      const result = await adjudicateViaNucleus({
        claim_id: claim.claim_id,
        member_id: claim.member_id,
        payer_name: payerName,
        procedure_code: line.procedure_code,
        provider_npi: line.rendering_provider_npi ?? claim.provider_npi,
        diagnosis_codes: line.diagnosis_codes,
        billed_amount_cents: line.billed_amount,
        units: line.units,
        place_of_service: line.place_of_service,
        service_date: line.service_date,
      });

      if (!result.configured) continue;
      if (result.decision === 'deny') {
        return { blocked: true, reason: `nucleus denied line ${line.line_id}: ${result.reason}` };
      }
      if (result.risk_tier === 'critical') {
        return {
          blocked: true,
          reason: `nucleus flagged line ${line.line_id} as critical risk: ${result.reason}`,
        };
      }
    }
  } catch (err) {
    console.error('Nucleus gate check failed, proceeding without it:', err);
  }

  return { blocked: false };
}

export default function ClaimsWorkbench() {
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [caseEvents, setCaseEvents] = useState<CaseEvent[]>([]);
  const [accumulators, setAccumulators] = useState<Record<string, MemberAccumulators>>({});
  const [adjResults, setAdjResults] = useState<AdjResult[]>([]);
  const [liveContract, setLiveContract] = useState<ContractTerms | null>(null);
  const [livePlan, setLivePlan] = useState<PlanBenefits | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await seedIfEmpty();
        const [c, k, e, a, runs] = await Promise.all([
          loadClaims(), loadCases(), loadCaseEvents(), loadAccumulators(), loadLatestRuns(),
        ]);
        if (cancelled) return;
        setClaims(c); setCases(k); setCaseEvents(e); setAccumulators(a);
        resetIdCounter();
        const haveRun = new Set(runs.map(r => r.claimId));
        const fresh: AdjResult[] = [];
        for (const claim of c) {
          if (haveRun.has(claim.claim_id)) continue;
          const acc = a[claim.member_id] ?? Object.values(a)[0];
          if (!acc) continue;

          // Outside demo mode, only adjudicate against real, admin-entered
          // contract + plan data. Never guess with a partial or zeroed
          // picture — a claim for a payer with no contract and/or plan on
          // file yet is left un-adjudicated rather than priced wrong.
          let contract = demoContract;
          let plan = demoPlan;
          let priorOutcomes = demoPriorOutcomes;
          if (!isDemoModeEnabled()) {
            const payerName = claim.intel?.payer_name;
            if (!payerName) continue;
            const [liveC, liveP] = await Promise.all([loadLiveContract(payerName), loadLivePlan(payerName)]);
            if (!liveC || !liveP) continue;
            contract = liveC; plan = liveP; priorOutcomes = [];
          }

          const gate = await checkNucleusGate(claim);
          if (gate.blocked) {
            console.warn(`Claim ${claim.claim_id} blocked by nucleus: ${gate.reason}`);
            const denied: Claim = { ...claim, status: 'DENIED' };
            await saveClaim(denied);
            setClaims(prev => prev.map(cl => (cl.claim_id === claim.claim_id ? denied : cl)));
            continue;
          }

          const { run, trace } = await executeAdjudicationWithReplay({
            claim,
            accumulators: acc,
            contract,
            plan,
            priorOutcomes,
            actor: 'ClaimsWorkbench',
          });
          fresh.push({ claimId: claim.claim_id, run, trace });
          await saveAdjudication(claim.claim_id, run, trace, false);
        }
        setAdjResults([...runs, ...fresh]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedResult = adjResults.find(r => r.claimId === selectedClaimId);
  const selectedClaim = claims.find(c => c.claim_id === selectedClaimId);
  const selectedCase = useMemo(() => {
    if (!selectedClaim) return null;
    if (selectedClaim.case_id) return cases.find(c => c.case_id === selectedClaim.case_id) ?? null;
    return cases.find(c => c.claim_ids.includes(selectedClaim.claim_id)) ?? null;
  }, [selectedClaim, cases]);
  const selectedCaseEvents = selectedCase ? caseEvents.filter(e => e.case_id === selectedCase.case_id) : [];

  // Foundation fix: outside demo mode, resolve the real on-file payer
  // contract + plan instead of showing the always-empty LIVE_CONTRACT/
  // LIVE_PLAN stubs.
  useEffect(() => {
    if (isDemoModeEnabled()) { setLiveContract(null); setLivePlan(null); return; }
    const payerName = selectedClaim?.intel?.payer_name;
    if (!payerName) { setLiveContract(null); setLivePlan(null); return; }
    let cancelled = false;
    Promise.all([loadLiveContract(payerName), loadLivePlan(payerName)]).then(([c, p]) => {
      if (cancelled) return;
      setLiveContract(c);
      setLivePlan(p);
    });
    return () => { cancelled = true; };
  }, [selectedClaim?.claim_id, selectedClaim?.intel?.payer_name]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Claims Workbench"
        subtitle="Deterministic adjudication · auditable decision path · COB transparency · payment waterfall · replayable trace."
      />
      {error && <div className="px-5 py-1.5 text-[11.5px] font-mono border-b text-destructive">Error: {error}</div>}
      <ClaimOperationsKpis claims={claims} adjResults={adjResults} cases={cases} />
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading adjudication data…
        </div>
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="w-[340px] shrink-0 border-r overflow-hidden">
            <ClaimList claims={claims} adjResults={adjResults} selectedClaimId={selectedClaimId} onSelect={setSelectedClaimId} />
          </div>
          <div className="flex-1 min-w-0 overflow-hidden">
            {selectedResult && selectedClaim ? (
              <ClaimWorkspace
                claim={selectedClaim} result={selectedResult}
                caseData={selectedCase} caseEvents={selectedCaseEvents}
                claims={claims} adjResults={adjResults} accumulators={accumulators}
                contract={isDemoModeEnabled() ? demoContract : (liveContract ?? LIVE_CONTRACT)}
                plan={isDemoModeEnabled() ? demoPlan : (livePlan ?? LIVE_PLAN)}
                priorOutcomes={isDemoModeEnabled() ? demoPriorOutcomes : []}
                onSelectClaim={setSelectedClaimId}
              />
            ) : (
              <EmptyState
                title="Select a claim to open its adjudication record"
                body="Each claim exposes the deterministic rule path, payment waterfall, COB determination, accumulator impact, and replayable audit trace."
                icon={<Inbox className="h-5 w-5" />}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
