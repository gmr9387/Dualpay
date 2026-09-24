/**
 * Claims Workbench — refactored from legacy DualPay Index.
 * Provides the deep adjudication / trace / state machine / case view
 * for individual claims as a secondary surface to Claim Clarity.
 *
 * Paginated (see repository.ts loadClaimsPage doc / the load-test commit
 * this followed): loading every claim's full payload on every visit does
 * not scale past a few thousand claims per org. "Shared" data (cases,
 * accumulators, the KPI sample) is fetched once via ensureBootstrap();
 * only the claims page itself, its adjudication runs, and the
 * on-this-page auto-adjudication loop re-run when `page` changes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
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
  loadClaimsPage, loadClaimById, loadClaimsByIds, loadCases, loadCaseEvents, loadAccumulators,
  loadRunsForClaims, loadRecentRunsForKpis, getClaimCounts,
  saveAdjudication, saveClaim, seedIfEmpty,
} from '@/data/repository';
import type { Claim, AdjudicationRun, MemberAccumulators } from '@/types/claim';
import type { TraceObject } from '@/types/trace';
import type { Case, CaseEvent, CaseStatus } from '@/types/case';
import { ClaimList } from '@/components/admin/ClaimList';
import { ClaimOperationsKpis } from '@/components/admin/ClaimOperationsKpis';
import { ClaimWorkspace } from '@/components/admin/ClaimWorkspace';
import { PageHeader, EmptyState } from '@/components/clarity/primitives';
import { Inbox, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

interface AdjResult { claimId: string; run: AdjudicationRun; trace: TraceObject; }

interface NucleusGateResult { blocked: boolean; reason?: string; }

const PAGE_SIZE = 50;

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

interface Bootstrap {
  cases: Case[];
  caseEvents: CaseEvent[];
  accumulators: Record<string, MemberAccumulators>;
  claimCounts: { total: number; needsReview: number };
  kpiClaims: Claim[];
  kpiRuns: AdjResult[];
}

export default function ClaimsWorkbench() {
  const { claimId: routeClaimId } = useParams<{ claimId?: string }>();
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [totalClaims, setTotalClaims] = useState(0);
  const [pageRuns, setPageRuns] = useState<AdjResult[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [caseEvents, setCaseEvents] = useState<CaseEvent[]>([]);
  const [accumulators, setAccumulators] = useState<Record<string, MemberAccumulators>>({});
  const [claimCounts, setClaimCounts] = useState({ total: 0, needsReview: 0 });
  const [kpiClaims, setKpiClaims] = useState<Claim[]>([]);
  const [kpiRuns, setKpiRuns] = useState<AdjResult[]>([]);
  const [liveContract, setLiveContract] = useState<ContractTerms | null>(null);
  const [livePlan, setLivePlan] = useState<PlanBenefits | null>(null);
  const [deepLinked, setDeepLinked] = useState<{ claim: Claim; result: AdjResult | null } | null>(null);

  // Page-independent data (cases, accumulators, the KPI sample) loads once
  // no matter how many times `page` changes -- the promise is cached so a
  // page change never re-triggers seedIfEmpty() or the KPI sample fetch.
  const bootstrapRef = useRef<Promise<Bootstrap> | null>(null);
  function ensureBootstrap(): Promise<Bootstrap> {
    if (!bootstrapRef.current) {
      bootstrapRef.current = (async () => {
        await seedIfEmpty();
        const [k, e, a, counts, sampleRuns] = await Promise.all([
          loadCases(), loadCaseEvents(), loadAccumulators(), getClaimCounts(), loadRecentRunsForKpis(),
        ]);
        const sampleClaims = await loadClaimsByIds(sampleRuns.map(r => r.claimId));
        return { cases: k, caseEvents: e, accumulators: a, claimCounts: counts, kpiClaims: sampleClaims, kpiRuns: sampleRuns };
      })();
    }
    return bootstrapRef.current;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const boot = await ensureBootstrap();
        if (cancelled) return;
        setCases(boot.cases); setCaseEvents(boot.caseEvents); setAccumulators(boot.accumulators);
        setClaimCounts(boot.claimCounts); setKpiClaims(boot.kpiClaims); setKpiRuns(boot.kpiRuns);

        const { claims: c, total } = await loadClaimsPage({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
        if (cancelled) return;
        setClaims(c); setTotalClaims(total);
        resetIdCounter();

        const existingRuns = await loadRunsForClaims(c.map(cl => cl.claim_id));
        if (cancelled) return;
        const haveRun = new Set(existingRuns.map(r => r.claimId));
        const fresh: AdjResult[] = [];
        for (const claim of c) {
          if (haveRun.has(claim.claim_id)) continue;
          const acc = boot.accumulators[claim.member_id] ?? Object.values(boot.accumulators)[0];
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
        if (cancelled) return;
        setPageRuns([...existingRuns, ...fresh]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [page]);

  // Deep link support (/claims/:claimId) -- e.g. from Payer Findings or
  // Contract Recovery. If the claim isn't on the current page, fetch it
  // directly rather than requiring the user to page to wherever it falls.
  useEffect(() => {
    if (!routeClaimId) { setDeepLinked(null); return; }
    if (claims.some(c => c.claim_id === routeClaimId)) {
      setSelectedClaimId(routeClaimId);
      setDeepLinked(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const claim = await loadClaimById(routeClaimId);
      if (cancelled || !claim) return;
      const runs = await loadRunsForClaims([routeClaimId]);
      if (cancelled) return;
      setDeepLinked({ claim, result: runs[0] ?? null });
      setSelectedClaimId(routeClaimId);
    })();
    return () => { cancelled = true; };
  }, [routeClaimId, claims]);

  const selectedClaim = claims.find(c => c.claim_id === selectedClaimId)
    ?? (deepLinked?.claim.claim_id === selectedClaimId ? deepLinked.claim : undefined);
  const selectedResult = pageRuns.find(r => r.claimId === selectedClaimId)
    ?? (deepLinked?.claim.claim_id === selectedClaimId ? deepLinked.result ?? undefined : undefined);
  const selectedCase = useMemo(() => {
    if (!selectedClaim) return null;
    if (selectedClaim.case_id) return cases.find(c => c.case_id === selectedClaim.case_id) ?? null;
    return cases.find(c => c.claim_ids.includes(selectedClaim.claim_id)) ?? null;
  }, [selectedClaim, cases]);
  const selectedCaseEvents = selectedCase ? caseEvents.filter(e => e.case_id === selectedCase.case_id) : [];

  const handleCaseEvent = (event: CaseEvent, newStatus?: CaseStatus) => {
    setCaseEvents(prev => [...prev, event]);
    if (newStatus) {
      setCases(prev => prev.map(c => (c.case_id === event.case_id ? { ...c, status: newStatus } : c)));
    }
  };

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

  const pageCount = Math.max(1, Math.ceil(totalClaims / PAGE_SIZE));

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Claims Workbench"
        subtitle="Deterministic adjudication · auditable decision path · COB transparency · payment waterfall · replayable trace."
      />
      {error && <div className="px-5 py-1.5 text-[11.5px] font-mono border-b text-destructive">Error: {error}</div>}
      <ClaimOperationsKpis
        totalCount={claimCounts.total}
        needsReviewCount={claimCounts.needsReview}
        kpiClaims={kpiClaims}
        kpiRuns={kpiRuns}
        cases={cases}
      />
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading adjudication data…
        </div>
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="w-[340px] shrink-0 border-r overflow-hidden flex flex-col">
            <div className="flex-1 min-h-0">
              <ClaimList claims={claims} adjResults={pageRuns} selectedClaimId={selectedClaimId} onSelect={setSelectedClaimId} />
            </div>
            <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-t bg-card text-[11.5px]">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="h-7 w-7 rounded border bg-card hover:bg-muted disabled:opacity-40 flex items-center justify-center"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-muted-foreground font-mono">
                Page {page + 1} of {pageCount} · {totalClaims.toLocaleString()} claims
              </span>
              <button
                onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="h-7 w-7 rounded border bg-card hover:bg-muted disabled:opacity-40 flex items-center justify-center"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex-1 min-w-0 overflow-hidden">
            {selectedResult && selectedClaim ? (
              <ClaimWorkspace
                claim={selectedClaim} result={selectedResult}
                caseData={selectedCase} caseEvents={selectedCaseEvents}
                claims={claims} adjResults={pageRuns} accumulators={accumulators}
                contract={isDemoModeEnabled() ? demoContract : (liveContract ?? LIVE_CONTRACT)}
                plan={isDemoModeEnabled() ? demoPlan : (livePlan ?? LIVE_PLAN)}
                priorOutcomes={isDemoModeEnabled() ? demoPriorOutcomes : []}
                onSelectClaim={setSelectedClaimId}
                onCaseEvent={handleCaseEvent}
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
