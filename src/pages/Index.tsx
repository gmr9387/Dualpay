import { useEffect, useMemo, useState } from 'react';
import { executeAdjudicationWithReplay } from '@/engine/adjudication-orchestrator';
import { demoContract, demoPlan, demoPriorOutcomes } from '@/data/demo-scenarios';
import { isDemoModeEnabled } from '@/lib/demo-flag';
import { LIVE_CONTRACT, LIVE_PLAN } from '@/lib/live-stubs';
import {
  loadClaims,
  loadCases,
  loadCaseEvents,
  loadAccumulators,
  loadLatestRuns,
  saveAdjudication,
  seedIfEmpty,
} from '@/data/repository';
import type { Claim, AdjudicationRun, MemberAccumulators } from '@/types/claim';
import type { TraceObject } from '@/types/trace';
import type { Case, CaseEvent, CaseStatus } from '@/types/case';
import { ClaimList } from '@/components/admin/ClaimList';
import { StatsBar } from '@/components/admin/StatsBar';
import { AppShell } from '@/components/admin/AppShell';
import { ClaimWorkspace } from '@/components/admin/ClaimWorkspace';
import { Inbox, Loader2 } from 'lucide-react';

interface AdjResult {
  claimId: string;
  run: AdjudicationRun;
  trace: TraceObject;
}

const Index = () => {
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [seedNotice, setSeedNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [claims, setClaims] = useState<Claim[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [caseEvents, setCaseEvents] = useState<CaseEvent[]>([]);
  const [accumulators, setAccumulators] = useState<Record<string, MemberAccumulators>>({});
  const [adjResults, setAdjResults] = useState<AdjResult[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { seeded } = await seedIfEmpty();

        if (cancelled) return;
        if (seeded) setSeedNotice('Seeded demo data into Lovable Cloud.');

        const [c, k, e, a, runs] = await Promise.all([
          loadClaims(),
          loadCases(),
          loadCaseEvents(),
          loadAccumulators(),
          loadLatestRuns(),
        ]);

        if (cancelled) return;

        setClaims(c);
        setCases(k);
        setCaseEvents(e);
        setAccumulators(a);

        const haveRun = new Set(runs.map((r) => r.claimId));
        const fresh: AdjResult[] = [];

        for (const claim of c) {
          if (haveRun.has(claim.claim_id)) continue;

          const acc = a[claim.member_id] ?? Object.values(a)[0];
          if (!acc) continue;
          if (!isDemoModeEnabled()) continue;

          const priors =
            claim.ohi_indicators.length > 0
              ? demoPriorOutcomes.filter((po) =>
                  claim.lines.some((line) => line.line_id === po.claim_line_id),
                )
              : [];

          const { run, trace } = await executeAdjudicationWithReplay({
            claim,
            accumulators: acc,
            contract: demoContract,
            plan: demoPlan,
            priorOutcomes: priors,
            actor: 'ClaimsWorkbench',
          });

          fresh.push({
            claimId: claim.claim_id,
            run,
            trace,
          });

          await saveAdjudication(claim.claim_id, run, trace, false);
        }

        setAdjResults([...runs, ...fresh]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedResult = adjResults.find((r) => r.claimId === selectedClaimId);
  const selectedClaim = claims.find((c) => c.claim_id === selectedClaimId);

  const selectedCase = useMemo(() => {
    if (!selectedClaim) return null;

    if (selectedClaim.case_id) {
      return cases.find((c) => c.case_id === selectedClaim.case_id) ?? null;
    }

    return cases.find((c) => c.claim_ids.includes(selectedClaim.claim_id)) ?? null;
  }, [selectedClaim, cases]);

  const selectedCaseEvents = selectedCase
    ? caseEvents.filter((event) => event.case_id === selectedCase.case_id)
    : [];

  const handleCaseEvent = (event: CaseEvent, newStatus?: CaseStatus) => {
    setCaseEvents((prev) => [...prev, event]);
    if (newStatus) {
      setCases((prev) => prev.map((c) => (c.case_id === event.case_id ? { ...c, status: newStatus } : c)));
    }
  };

  const breadcrumb = [
    { label: 'Operations' },
    { label: 'Claims Workbench', onClick: () => setSelectedClaimId(null) },
    ...(selectedClaim ? [{ label: selectedClaim.claim_id }] : []),
  ];

  return (
    <AppShell breadcrumb={breadcrumb} cloudOnline={!error}>
      <div className="flex flex-col h-full">
        {(seedNotice || error) && (
          <div className="px-5 py-1.5 text-[11.5px] font-mono border-b flex items-center gap-3">
            {seedNotice && <span className="text-status-paid">{seedNotice}</span>}
            {error && <span className="text-destructive">Cloud error: {error}</span>}
          </div>
        )}

        <StatsBar adjResults={adjResults} />

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Hydrating from Lovable Cloud…
            </div>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0 overflow-hidden">
            <div className="w-[340px] shrink-0 border-r overflow-hidden">
              <ClaimList
                claims={claims}
                adjResults={adjResults}
                selectedClaimId={selectedClaimId}
                onSelect={setSelectedClaimId}
              />
            </div>

            <div className="flex-1 min-w-0 overflow-hidden">
              {selectedResult && selectedClaim ? (
                <ClaimWorkspace
                  claim={selectedClaim}
                  result={selectedResult}
                  caseData={selectedCase}
                  caseEvents={selectedCaseEvents}
                  claims={claims}
                  adjResults={adjResults}
                  accumulators={accumulators}
                  contract={isDemoModeEnabled() ? demoContract : LIVE_CONTRACT}
                  plan={isDemoModeEnabled() ? demoPlan : LIVE_PLAN}
                  priorOutcomes={isDemoModeEnabled() ? demoPriorOutcomes : []}
                  onCaseEvent={handleCaseEvent}
                  onSelectClaim={setSelectedClaimId}
                />
              ) : (
                <EmptyState />
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="h-12 w-12 mx-auto rounded-full bg-muted flex items-center justify-center mb-3">
          <Inbox className="h-5 w-5 text-muted-foreground" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Select a claim to begin</h3>
        <p className="text-[12.5px] text-muted-foreground mt-1">
          Pick a claim from the queue to view adjudication, COB allocation, audit trace,
          and the linked case if one exists.
        </p>
      </div>
    </div>
  );
}

export default Index;