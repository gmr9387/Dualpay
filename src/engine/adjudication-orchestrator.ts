/**
 * Adjudication Orchestrator
 *
 * Preferred kernel entry point for adjudications that must be
 * replayable, fingerprinted, and ledgered.
 *
 * The actual compute step (deriving run+trace from claim/accumulators/
 * contract/plan/priorOutcomes) now calls valtaris-nucleus's real
 * adjudicate-claim Edge Function in its "resolved" request mode,
 * rather than this repo's own local calculation-engine.ts. Nucleus's
 * kernel is a verified byte-for-byte port of this repo's own
 * calculation-engine.ts/cob-rules.ts, so the math itself is identical;
 * what moves is where it runs. Idempotency, persistence, and the
 * replay ledger below are entirely unchanged -- this orchestrator's
 * own fingerprint check still runs first and is still the primary
 * guard against a duplicate adjudication *request* ever being sent;
 * nucleus's own idempotency cache (keyed by that same fingerprint) is
 * an additional, defense-in-depth layer against a network-level retry.
 *
 * calculation-engine.ts/cob-rules.ts are deliberately left in place,
 * not deleted -- they remain real, tested, working code; this change
 * is about which path live claim processing calls, not about deleting
 * a large, correct kernel that may still be useful (tests reference
 * it directly, and it documents the exact math nucleus now runs).
 */

import type {
  Claim,
  MemberAccumulators,
  ContractTerms,
  PlanBenefits,
  PriorPayerOutcome,
  AdjudicationRun,
} from '@/types/claim';
import type { TraceObject } from '@/types/trace';

import { adjudicateClaimViaNucleus } from './nucleus-adjudication-client';
import { createReplaySnapshot, type ReplaySnapshot } from './replay-snapshot';
import { buildTraceFingerprint } from './hash';
import { saveReplayRecord, getReplayRecordByFingerprint, hasRunId, getReplayRecordByRunId } from './replay-store';
import { appendLedgerEvent, type ReplayLedgerEvent } from './replay-ledger';

const DEFAULT_CALC_POLICY_VERSION = '1.0.0';
const DEFAULT_RULE_SET_VERSION = '1.0.0';
const DEFAULT_COB_RULE_VERSION = '1.0.0';
const DEFAULT_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export interface ExecuteAdjudicationArgs {
  claim: Claim;
  accumulators: MemberAccumulators;
  contract: ContractTerms;
  plan: PlanBenefits;
  priorOutcomes?: PriorPayerOutcome[];

  actor?: string;
  runId?: string;
  timestamp?: string;
  calcPolicyVersion?: string;
  ruleSetVersion?: string;
  cobRuleVersion?: string;

  feeScheduleHash?: string;
  planDocumentHash?: string;
  contractDocumentHash?: string;
}

export interface ExecuteAdjudicationResult {
  run: AdjudicationRun;
  trace: TraceObject;
  snapshot: ReplaySnapshot;
  fingerprint: string;
  ledger_events: ReplayLedgerEvent[];
}

export async function executeAdjudicationWithReplay(
  args: ExecuteAdjudicationArgs,
): Promise<ExecuteAdjudicationResult> {
  const timestamp = args.timestamp ?? DEFAULT_TIMESTAMP;
  const actor = args.actor ?? 'system';
  const calcPolicyVersion =
    args.calcPolicyVersion ?? DEFAULT_CALC_POLICY_VERSION;
  const priorOutcomes = args.priorOutcomes ?? [];

  const runId =
    args.runId ?? `run_${args.claim.claim_id}_${calcPolicyVersion}`;

  const ruleSetVersion =
    args.ruleSetVersion ?? DEFAULT_RULE_SET_VERSION;
  const cobRuleVersion =
    args.cobRuleVersion ?? DEFAULT_COB_RULE_VERSION;

  const snapshot = createReplaySnapshot({
    claim: args.claim,
    accumulators: args.accumulators,
    contract: args.contract,
    plan: args.plan,
    priorOutcomes,
    calcPolicyVersion,
    ruleSetVersion,
    cobRuleVersion,
    feeScheduleHash: args.feeScheduleHash,
    planDocumentHash: args.planDocumentHash,
    contractDocumentHash: args.contractDocumentHash,
    createdAt: timestamp,
  });

  const fingerprint = await buildTraceFingerprint({
    claim: snapshot.claim,
    lines: snapshot.claim.lines,
    accumulators: snapshot.accumulators,
    contract: snapshot.contract,
    plan: snapshot.plan,
    priorOutcomes: snapshot.prior_outcomes,
    calcPolicyVersion: snapshot.calc_policy_version,
    ruleSetVersion: snapshot.rule_set_version,
    cobRuleVersion: snapshot.cob_rule_version,
    feeScheduleHash: snapshot.fee_schedule_hash,
    planDocumentHash: snapshot.plan_document_hash,
    contractDocumentHash: snapshot.contract_document_hash,
  });

  // Idempotency: return existing record if this exact canonical input was adjudicated before.
  const existing = getReplayRecordByFingerprint(fingerprint);
  if (existing) {
    const dupLedger = await appendLedgerEvent({
      type: 'REPLAY_EXECUTED',
      claim_id: args.claim.claim_id,
      run_id: existing.run.run_id,
      snapshot_id: existing.snapshot.snapshot_id,
      actor,
      timestamp,
      details: {
        reason: 'duplicate_fingerprint_idempotent_return',
        fingerprint,
      },
    });
    // Reconstruct trace deterministically. Uses the same fingerprint as
    // idempotency_key, so this hits nucleus's own replay cache and
    // returns instantly rather than recomputing -- existing.run (not
    // this call's run) stays authoritative, matching prior behavior
    // exactly; only .trace is used from the response.
    const replay = await adjudicateClaimViaNucleus(
      args.claim,
      args.accumulators,
      args.contract,
      args.plan,
      priorOutcomes,
      {
        idempotencyKey: fingerprint,
        runId: existing.run.run_id,
        timestamp: existing.created_at,
        snapshotRef: `snapshots/${existing.run.run_id}/${fingerprint}`,
        traceId: `trace_${args.claim.claim_id}_${fingerprint.slice(0, 16)}`,
      },
    );
    return {
      run: existing.run,
      trace: replay.trace,
      snapshot: existing.snapshot,
      fingerprint,
      ledger_events: [dupLedger],
    };
  }

  // Reject run_id collisions across distinct fingerprints.
  if (hasRunId(runId)) {
    const conflicting = getReplayRecordByRunId(runId);
    throw new Error(
      `run_id ${runId} already used for fingerprint ${conflicting?.fingerprint}; refusing to reuse for ${fingerprint}`,
    );
  }

  const snapshotRef = `snapshots/${runId}/${fingerprint}`;
  const traceId = `trace_${args.claim.claim_id}_${fingerprint.slice(0, 16)}`;

  const { run, trace } = await adjudicateClaimViaNucleus(
    args.claim,
    args.accumulators,
    args.contract,
    args.plan,
    priorOutcomes,
    {
      idempotencyKey: fingerprint,
      runId,
      timestamp,
      snapshotRef,
      traceId,
    },
  );

  saveReplayRecord({
    snapshot,
    run,
    fingerprint,
    created_at: timestamp,
  });

  const ledger_events: ReplayLedgerEvent[] = [];

  ledger_events.push(
    await appendLedgerEvent({
      type: 'ADJUDICATION_CREATED',
      claim_id: args.claim.claim_id,
      run_id: run.run_id,
      snapshot_id: snapshot.snapshot_id,
      actor,
      timestamp,
      details: {
        trace_id: trace.trace_id,
        total_plan_paid: run.total_plan_paid,
        total_member_responsibility: run.total_member_responsibility,
      },
    }),
  );

  ledger_events.push(
    await appendLedgerEvent({
      type: 'SNAPSHOT_CREATED',
      claim_id: args.claim.claim_id,
      run_id: run.run_id,
      snapshot_id: snapshot.snapshot_id,
      actor,
      timestamp,
      details: {
        calc_policy_version: calcPolicyVersion,
        snapshot_ref: snapshotRef,
      },
    }),
  );

  ledger_events.push(
    await appendLedgerEvent({
      type: 'FINGERPRINT_CREATED',
      claim_id: args.claim.claim_id,
      run_id: run.run_id,
      snapshot_id: snapshot.snapshot_id,
      actor,
      timestamp,
      details: {
        fingerprint,
      },
    }),
  );

  ledger_events.push(
    await appendLedgerEvent({
      type: 'REPLAY_RECORD_SAVED',
      claim_id: args.claim.claim_id,
      run_id: run.run_id,
      snapshot_id: snapshot.snapshot_id,
      actor,
      timestamp,
      details: {
        replay_ready: true,
      },
    }),
  );

  return {
    run,
    trace,
    snapshot,
    fingerprint,
    ledger_events,
  };
}