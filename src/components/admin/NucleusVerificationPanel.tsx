/**
 * Nucleus Verification — a real, additive cross-check against
 * valtaris-nucleus's live Guardian kill switch, Weaver scoring engine,
 * and real adjudication engine, via the server-side proxy Edge
 * Functions (nucleus-guardian-status, nucleus-weaver-score,
 * nucleus-adjudicate) that already hold nucleus's API key.
 *
 * Presentation only: nothing here gates or changes this claim's local
 * adjudication above, or this claim's own status/payment.
 *
 * `adjudicate-claim` requires a real `payer_name` per call. This repo
 * doesn't carry one on the `Claim` type directly, but every real claim
 * (the only claim-creation path in this repo is the Recovery Factory
 * import — engine/import-to-claim.ts's rowToClaim(), confirmed by
 * grepping for every place a Claim object is actually constructed)
 * gets a real `payer_name` computed from the import row and stored on
 * `claim.intel.payer_name` (types/clarity.ts's ClaimIntel — required
 * whenever `intel` itself is present). This calls adjudicate-claim
 * once per real claim line, using that real payer_name plus each
 * line's own real procedure/diagnosis/amount/service-date fields --
 * no fabricated data. Claims without an `intel` envelope (demo-seeded
 * claims, mainly) show a clear "not available" state instead of
 * guessing a payer.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Claim } from '@/types/claim';
import {
  checkNucleusGuardianStatus,
  type NucleusGuardianStatusResult,
  type NucleusGuardianStatusNotConfigured,
} from '@/engine/nucleus-guardian-status-client';
import {
  scoreViaNucleusWeaver,
  type NucleusWeaverScoreResult,
  type NucleusWeaverScoreNotConfigured,
} from '@/engine/nucleus-weaver-client';
import {
  adjudicateViaNucleus,
  type NucleusAdjudicationResult,
  type NucleusAdjudicationNotConfigured,
} from '@/engine/nucleus-adjudication-client';
import { ShieldCheck, ShieldAlert, Loader2, Sparkles, Scale } from 'lucide-react';

interface Props {
  claim: Claim;
}

type GuardianState =
  | { phase: 'loading' }
  | { phase: 'done'; result: NucleusGuardianStatusResult | NucleusGuardianStatusNotConfigured }
  | { phase: 'error'; message: string };

type WeaverState =
  | { phase: 'loading' }
  | { phase: 'done'; result: NucleusWeaverScoreResult | NucleusWeaverScoreNotConfigured }
  | { phase: 'error'; message: string };

type AdjudicationLineState =
  | { phase: 'loading' }
  | { phase: 'done'; result: NucleusAdjudicationResult | NucleusAdjudicationNotConfigured }
  | { phase: 'error'; message: string };

export function NucleusVerificationPanel({ claim }: Props) {
  const [guardian, setGuardian] = useState<GuardianState>({ phase: 'loading' });
  const [weaver, setWeaver] = useState<WeaverState>({ phase: 'loading' });
  const [adjudication, setAdjudication] = useState<Record<string, AdjudicationLineState>>({});

  useEffect(() => {
    let cancelled = false;
    checkNucleusGuardianStatus()
      .then((result) => {
        if (!cancelled) setGuardian({ phase: 'done', result });
      })
      .catch((err) => {
        if (!cancelled) {
          setGuardian({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Only facts this repo's own Claim object genuinely carries --
    // no invented payer or contract data.
    const facts = {
      claim_type: claim.claim_type,
      total_billed_cents: claim.total_billed,
      line_count: claim.lines.length,
      procedure_codes: claim.lines.map((l) => l.procedure_code),
      diagnosis_codes: [...new Set(claim.lines.flatMap((l) => l.diagnosis_codes))],
      ohi_count: claim.ohi_indicators.length,
    };
    scoreViaNucleusWeaver({ stage: 'opportunity', claim_id: claim.claim_id, facts })
      .then((result) => {
        if (!cancelled) setWeaver({ phase: 'done', result });
      })
      .catch((err) => {
        if (!cancelled) {
          setWeaver({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [claim.claim_id, claim.claim_type, claim.total_billed, claim.lines, claim.ohi_indicators.length]);

  const payerName = claim.intel?.payer_name;

  useEffect(() => {
    if (!payerName) return;
    let cancelled = false;

    for (const line of claim.lines) {
      setAdjudication((prev) => ({ ...prev, [line.line_id]: { phase: 'loading' } }));

      adjudicateViaNucleus({
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
      })
        .then((result) => {
          if (!cancelled) {
            setAdjudication((prev) => ({ ...prev, [line.line_id]: { phase: 'done', result } }));
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setAdjudication((prev) => ({
              ...prev,
              [line.line_id]: {
                phase: 'error',
                message: err instanceof Error ? err.message : String(err),
              },
            }));
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [claim.claim_id, claim.member_id, claim.provider_npi, claim.lines, payerName]);

  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Nucleus Verification
        </span>
      </div>
      <div className="divide-y">
        <GuardianRow state={guardian} />
        <WeaverRow state={weaver} />
        {payerName ? (
          claim.lines.map((line) => (
            <AdjudicationRow
              key={line.line_id}
              line={line}
              state={adjudication[line.line_id] ?? { phase: 'loading' }}
            />
          ))
        ) : (
          <Row
            icon={<ShieldAlert className="h-4 w-4 text-muted-foreground" />}
            label="Nucleus Adjudication"
            detail="Payer name not available for this claim (no intel envelope) — skipped rather than guessed"
          />
        )}
      </div>
      <p className="px-4 py-2 text-[11px] text-muted-foreground">
        Real, read-only cross-checks against valtaris-nucleus's live Guardian kill switch, Weaver
        scoring engine, and adjudication engine. Presentation only — this claim's adjudication
        above and its status/payment are unaffected.
      </p>
    </section>
  );
}

function GuardianRow({ state }: { state: GuardianState }) {
  if (state.phase === 'loading') {
    return (
      <Row
        icon={<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        label="Guardian Kill Switch"
        detail="Checking…"
      />
    );
  }
  if (state.phase === 'error') {
    return (
      <Row
        icon={<ShieldAlert className="h-4 w-4 text-status-denied" />}
        label="Guardian Kill Switch"
        detail={state.message}
      />
    );
  }
  const { result } = state;
  if (!result.configured) {
    return (
      <Row
        icon={<ShieldAlert className="h-4 w-4 text-muted-foreground" />}
        label="Guardian Kill Switch"
        detail="Not configured on nucleus's side yet"
      />
    );
  }
  return (
    <Row
      icon={
        result.safe_to_process ? (
          <ShieldCheck className="h-4 w-4 text-status-paid" />
        ) : (
          <ShieldAlert className="h-4 w-4 text-status-denied" />
        )
      }
      label="Guardian Kill Switch"
      detail={result.safe_to_process ? 'Safe to process' : result.reason ?? 'Processing halted'}
    />
  );
}

function WeaverRow({ state }: { state: WeaverState }) {
  if (state.phase === 'loading') {
    return (
      <Row
        icon={<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        label="Weaver Opportunity Score"
        detail="Scoring…"
      />
    );
  }
  if (state.phase === 'error') {
    return (
      <Row
        icon={<ShieldAlert className="h-4 w-4 text-status-denied" />}
        label="Weaver Opportunity Score"
        detail={state.message}
      />
    );
  }
  const { result } = state;
  if (!result.configured) {
    return (
      <Row
        icon={<ShieldAlert className="h-4 w-4 text-muted-foreground" />}
        label="Weaver Opportunity Score"
        detail="Not configured on nucleus's side yet"
      />
    );
  }
  if (result.stage !== 'opportunity') {
    return null;
  }
  return (
    <Row
      icon={<Sparkles className="h-4 w-4 text-primary" />}
      label="Weaver Opportunity Score"
      detail={`${result.score.toFixed(1)} / 100${result.fired_rules.length ? ` · ${result.fired_rules.join(', ')}` : ''}`}
    />
  );
}

function AdjudicationRow({
  line,
  state,
}: {
  line: Claim['lines'][number];
  state: AdjudicationLineState;
}) {
  const label = `Nucleus Adjudication · Line ${line.claim_line_number} (${line.procedure_code})`;

  if (state.phase === 'loading') {
    return (
      <Row
        icon={<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        label={label}
        detail="Adjudicating…"
      />
    );
  }
  if (state.phase === 'error') {
    return <Row icon={<ShieldAlert className="h-4 w-4 text-status-denied" />} label={label} detail={state.message} />;
  }
  const { result } = state;
  if (!result.configured) {
    return (
      <Row
        icon={<ShieldAlert className="h-4 w-4 text-muted-foreground" />}
        label={label}
        detail="Not configured on nucleus's side yet"
      />
    );
  }
  const adj = result.adjudication;
  const detail = adj
    ? `${result.decision.toUpperCase()} · plan paid ${formatCents(adj.plan_paid)} · member owes ${formatCents(adj.member_responsibility)} · risk ${result.risk_tier}`
    : `${result.decision.toUpperCase()} · ${result.reason}`;
  return (
    <Row
      icon={
        result.decision === 'allow' ? (
          <Scale className="h-4 w-4 text-status-paid" />
        ) : (
          <Scale className="h-4 w-4 text-status-denied" />
        )
      }
      label={label}
      detail={detail}
    />
  );
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Row({ icon, label, detail }: { icon: ReactNode; label: string; detail: string }) {
  return (
    <div className="grid grid-cols-[24px_1fr] gap-3 items-center px-4 py-2 text-[12px]">
      {icon}
      <div className="min-w-0">
        <div className="text-foreground font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground truncate">{detail}</div>
      </div>
    </div>
  );
}
