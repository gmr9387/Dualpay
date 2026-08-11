// Claim State Machine — explicit transitions with guards and audit trail

import type { ClaimStatus } from '@/types/claim';

export interface TransitionGuard {
  id: string;
  description: string;
  /** Returns true if transition is allowed */
  check: (context: TransitionContext) => boolean;
}

export interface TransitionContext {
  claimId: string;
  currentStatus: ClaimStatus;
  targetStatus: ClaimStatus;
  hasPrimacyConfirmation?: boolean;
  hasExceptionOverride?: boolean;
  hasIdempotencyKey?: boolean;
  idempotencyKey?: string;
  userId?: string;
  timestamp?: string;
}

export interface TransitionResult {
  allowed: boolean;
  fromStatus: ClaimStatus;
  toStatus: ClaimStatus;
  failedGuards: string[];
  appliedGuards: string[];
  idempotencyKey?: string;
}

export interface StatusTransition {
  from: ClaimStatus;
  to: ClaimStatus;
  guards: TransitionGuard[];
  label: string;
}

// ── Guards ────────────────────────────────────────────────────

const requirePrimacyConfirmation: TransitionGuard = {
  id: 'REQUIRE_PRIMACY_CONFIRMATION',
  description:
    'COB-routed claims require primacy confirmation or audited exception override before payment',
  check: (ctx) => !!ctx.hasPrimacyConfirmation || !!ctx.hasExceptionOverride,
};

const requireIdempotencyKey: TransitionGuard = {
  id: 'REQUIRE_IDEMPOTENCY_KEY',
  description:
    'Payment actions require an idempotency key to prevent duplicate payouts',
  check: (ctx) => typeof ctx.idempotencyKey === 'string' && ctx.idempotencyKey.length > 0,
};

// ── Idempotency Registry (In-Memory UI Cache — NOT authoritative) ──────────
//
// Phase 4B: The in-memory Set is retained ONLY as a UI-layer hint to avoid
// redundant RPC calls within a single browser session.  It is NOT the
// authoritative idempotency gate for financial mutations.
//
// The authoritative gate is the `idempotency_keys` table in PostgreSQL,
// enforced by the SECURITY DEFINER RPCs (rpc_advance_payment_state,
// rpc_log_recovery_event, rpc_log_write_off, rpc_advance_appeal_case).
//
// Do NOT use consumedIdempotencyKeys or consumeIdempotencyKey to decide
// whether a financial mutation may proceed.

const consumedIdempotencyKeys = new Set<string>();

let idempotencyInitialized = false;

/**
 * Initialize idempotency key tracking from persistent storage.
 * Call once on app startup.
 *
 * Phase 4B: This warms the in-memory UI cache.  The database RPCs are the
 * authoritative source of truth and do not depend on this cache being warm.
 */
export async function initializeIdempotencyKeyTracking(): Promise<void> {
  if (idempotencyInitialized) return;

  try {
    consumedIdempotencyKeys.clear();
    idempotencyInitialized = true;
  } catch (error) {
    console.error('Failed to initialize idempotency key tracking:', error);
    idempotencyInitialized = true;
  }
}

/**
 * UI cache hint: marks a key as consumed in the local session cache.
 *
 * Phase 4B: NOT the authoritative payment gate.  Returns true on first local
 * use, false if the key is already in the cache.  This does NOT prevent a
 * second financial mutation — use `advancePaymentState` for that.
 */
export function consumeIdempotencyKey(key: string): boolean {
  if (!key) return false;
  if (consumedIdempotencyKeys.has(key)) return false;
  consumedIdempotencyKeys.add(key);
  return true;
}

/**
 * UI cache hint: returns true if the key is in the local session cache.
 * Phase 4B: NOT a substitute for the persistent DB check.
 */
export function isIdempotencyKeyConsumed(key: string): boolean {
  return consumedIdempotencyKeys.has(key);
}

/**
 * Advance a claim through a payment state transition using the authoritative
 * server-side RPC.
 *
 * Phase 4B: This is the ONLY supported path for executing a payment mutation.
 * The RPC atomically:
 *   1. validates org membership
 *   2. checks the idempotency key in PostgreSQL
 *   3. updates claims.status
 *   4. records the idempotency key
 * All in a single transaction.
 *
 * Returns the result from the RPC.  If `already_consumed` is true the
 * original result_id is returned without re-executing the mutation.
 */
export async function advancePaymentState(params: {
  idempotencyKey: string;
  claimId: string;
  orgId: string;
  fromStatus: ClaimStatus;
  toStatus: ClaimStatus;
  actor: string;
}): Promise<{ already_consumed: boolean; result_id: string; new_status: string }> {
  const { supabase } = await import('@/integrations/supabase/client');

  const { data, error } = await supabase.rpc('rpc_advance_payment_state', {
    p_idempotency_key: params.idempotencyKey,
    p_claim_id:        params.claimId,
    p_org_id:          params.orgId,
    p_from_status:     params.fromStatus,
    p_to_status:       params.toStatus,
    p_actor:           params.actor,
  } as never);

  if (error) throw error;

  const result = data as { already_consumed: boolean; result_id: string; new_status: string };

  // Warm the UI cache on success.
  if (!result.already_consumed) {
    consumedIdempotencyKeys.add(params.idempotencyKey);
  }

  return result;
}

/** Test/dev only — clears the in-memory UI cache. */
export function clearIdempotencyKeysForDev(): void {
  consumedIdempotencyKeys.clear();
  idempotencyInitialized = false;
}

function isPaymentTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return (
    (from === 'ADJUDICATED' && to === 'PAYMENT_IN_PROGRESS') ||
    (from === 'PAYMENT_IN_PROGRESS' && to === 'PAID')
  );
}

const noGuard: TransitionGuard = {
  id: 'NO_GUARD',
  description: 'No additional checks required',
  check: () => true,
};

// ── Transition Definitions ────────────────────────────────────

export const CLAIM_TRANSITIONS: StatusTransition[] = [
  // Intake
  {
    from: 'RECEIVED',
    to: 'ELIGIBILITY_CHECK',
    guards: [noGuard],
    label: 'Begin eligibility',
  },

  // Eligibility → routing
  {
    from: 'ELIGIBILITY_CHECK',
    to: 'COB_ROUTED',
    guards: [noGuard],
    label: 'OHI detected → route COB',
  },
  {
    from: 'ELIGIBILITY_CHECK',
    to: 'IN_ADJUDICATION',
    guards: [noGuard],
    label: 'No OHI → adjudicate',
  },

  // COB flow
  {
    from: 'COB_ROUTED',
    to: 'AWAITING_PRIMARY_EOB',
    guards: [noGuard],
    label: 'Request primary EOB',
  },
  {
    from: 'AWAITING_PRIMARY_EOB',
    to: 'IN_ADJUDICATION',
    guards: [requirePrimacyConfirmation],
    label: 'Primary EOB received',
  },
  {
    from: 'COB_ROUTED',
    to: 'IN_ADJUDICATION',
    guards: [requirePrimacyConfirmation],
    label: 'Primacy confirmed → adjudicate',
  },

  // Adjudication
  {
    from: 'IN_ADJUDICATION',
    to: 'ADJUDICATED',
    guards: [noGuard],
    label: 'Adjudication complete',
  },
  {
    from: 'IN_ADJUDICATION',
    to: 'PENDED',
    guards: [noGuard],
    label: 'Pend for review',
  },
  {
    from: 'IN_ADJUDICATION',
    to: 'DENIED',
    guards: [noGuard],
    label: 'Deny claim',
  },

  // Pend resolution
  {
    from: 'PENDED',
    to: 'IN_ADJUDICATION',
    guards: [noGuard],
    label: 'Resume adjudication',
  },
  {
    from: 'PENDED',
    to: 'DENIED',
    guards: [noGuard],
    label: 'Deny after review',
  },

  // Payment flow
  {
    from: 'ADJUDICATED',
    to: 'PAYMENT_IN_PROGRESS',
    guards: [requireIdempotencyKey],
    label: 'Initiate payment',
  },
  {
    from: 'PAYMENT_IN_PROGRESS',
    to: 'PAID',
    guards: [requireIdempotencyKey],
    label: 'Payment confirmed',
  },

  // Post-payment
  {
    from: 'PAID',
    to: 'REVERSED',
    guards: [noGuard],
    label: 'Reverse payment',
  },
  {
    from: 'PAID',
    to: 'ADJUSTED',
    guards: [noGuard],
    label: 'Adjust claim',
  },
  {
    from: 'REVERSED',
    to: 'IN_ADJUDICATION',
    guards: [noGuard],
    label: 'Re-adjudicate',
  },
  {
    from: 'ADJUSTED',
    to: 'IN_ADJUDICATION',
    guards: [noGuard],
    label: 'Re-adjudicate',
  },
];

// ── All valid statuses (ordered for display) ────────────────

export const ALL_STATUSES: ClaimStatus[] = [
  'RECEIVED',
  'ELIGIBILITY_CHECK',
  'COB_ROUTED',
  'AWAITING_PRIMARY_EOB',
  'IN_ADJUDICATION',
  'PENDED',
  'ADJUDICATED',
  'DENIED',
  'PAYMENT_IN_PROGRESS',
  'PAID',
  'REVERSED',
  'ADJUSTED',
];

// ── Engine Functions ──────────────────────────────────────────

export function getValidTransitions(
  currentStatus: ClaimStatus,
): StatusTransition[] {
  return CLAIM_TRANSITIONS.filter(
    (t) => t.from === currentStatus,
  );
}

export function canTransition(
  context: TransitionContext,
): TransitionResult {
  const transition = CLAIM_TRANSITIONS.find(
    (t) =>
      t.from === context.currentStatus &&
      t.to === context.targetStatus,
  );

  if (!transition) {
    return {
      allowed: false,
      fromStatus: context.currentStatus,
      toStatus: context.targetStatus,
      failedGuards: ['NO_VALID_TRANSITION'],
      appliedGuards: [],
    };
  }

  const failedGuards: string[] = [];
  const appliedGuards: string[] = [];

  for (const guard of transition.guards) {
    if (guard.id === 'NO_GUARD') continue;

    appliedGuards.push(guard.id);

    if (!guard.check(context)) {
      failedGuards.push(guard.id);
    }
  }

  // Phase 4B: The in-memory Set is no longer the authoritative idempotency
  // gate.  The check below is retained only as a UI-layer hint so that the
  // state diagram can reflect a locally-known consumed key.  The actual
  // enforcement happens inside rpc_advance_payment_state on the DB.
  const paymentTransition = isPaymentTransition(
    context.currentStatus,
    context.targetStatus,
  );
  if (
    paymentTransition &&
    !failedGuards.includes('REQUIRE_IDEMPOTENCY_KEY') &&
    context.idempotencyKey &&
    consumedIdempotencyKeys.has(context.idempotencyKey)
  ) {
    failedGuards.push('IDEMPOTENCY_KEY_ALREADY_USED');
  }

  return {
    allowed: failedGuards.length === 0,
    fromStatus: context.currentStatus,
    toStatus: context.targetStatus,
    failedGuards,
    appliedGuards,
    idempotencyKey: context.idempotencyKey,
  };
}

export function getStatusCategory(
  status: ClaimStatus,
): 'intake' | 'cob' | 'adjudication' | 'payment' | 'terminal' {
  switch (status) {
    case 'RECEIVED':
    case 'ELIGIBILITY_CHECK':
      return 'intake';

    case 'COB_ROUTED':
    case 'AWAITING_PRIMARY_EOB':
      return 'cob';

    case 'IN_ADJUDICATION':
    case 'PENDED':
    case 'ADJUDICATED':
      return 'adjudication';

    case 'PAYMENT_IN_PROGRESS':
    case 'PAID':
      return 'payment';

    case 'DENIED':
    case 'REVERSED':
    case 'ADJUSTED':
      return 'terminal';
  }
}
