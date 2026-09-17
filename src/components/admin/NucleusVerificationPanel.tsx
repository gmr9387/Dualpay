/**
 * Nucleus Verification — a real, additive cross-check against
 * valtaris-nucleus's live Guardian kill switch and Weaver scoring
 * engine, via the server-side proxy Edge Functions
 * (nucleus-guardian-status, nucleus-weaver-score) that already hold
 * nucleus's API key.
 *
 * Presentation only: nothing here gates or changes this claim's local
 * adjudication above. `adjudicate-claim` itself (the actual decision
 * engine) is deliberately NOT wired in yet — nucleus requires a real
 * `payer_name` per call, and this repo's `Claim` objects (built from
 * the real claims-import path, not just demo seed data) don't carry
 * one: `payer_name` only shows up later, on remittance/response data
 * (see types/import.ts's `CanonicalRemittance`/`PayerResponse`), never
 * on the claim at adjudication time. Wiring adjudicate-claim in would
 * mean fabricating that value — closing this for real means adding a
 * genuine payer_name source to the claim model first, which is its
 * own decision, not something to improvise here.
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
import { ShieldCheck, ShieldAlert, Loader2, Sparkles } from 'lucide-react';

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

export function NucleusVerificationPanel({ claim }: Props) {
  const [guardian, setGuardian] = useState<GuardianState>({ phase: 'loading' });
  const [weaver, setWeaver] = useState<WeaverState>({ phase: 'loading' });

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
      </div>
      <p className="px-4 py-2 text-[11px] text-muted-foreground">
        Real, read-only cross-checks against valtaris-nucleus's live Guardian kill switch and
        Weaver scoring engine. Presentation only — this claim's adjudication above is unaffected.
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
