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

// ── Idempotency Registry (In-Memory Cache) ──────────────────

const consumedIdempotencyKeys = new Set<string>();

let idempotencyInitialized = false;

/**
 * Initialize idempotency key tracking from persistent storage.
 * Call once on app startup.
 */
export async function initializeIdempotencyKeyTracking(): Promise<void> {
  if (idempotencyInitialized) return;

  try {
    // Note: In a full implementation, we would load all consumed keys from the DB.
    // For now, we start fresh and rely on DB as the source of truth.
    // Each call to isIdempotencyKeyConsumedPersistent checks the DB directly.
    consumedIdempotencyKeys.clear();
    idempotencyInitialized = true;
  } catch (error) {
    console.error('Failed to initialize idempotency key tracking:', error);
    idempotencyInitialized = true;
  }
}

/**
 * Consume an idempotency key. Returns true on first use, false if already consumed.
 * 
 * This is the in-memory check. For production, always verify against the DB as well.
 * 
 * Callers that perform side-effectful payment work should invoke this before
 * acting and abort if it returns false.
 */
export function consumeIdempotencyKey(key: string): boolean {
  if (!key) return false;
  if (consumedIdempotencyKeys.has(key)) return false;
  consumedIdempotencyKeys.add(key);
  return true;
}

/**
 * Check if an idempotency key has been consumed (in-memory check only).
 */
export function isIdempotencyKeyConsumed(key: string): boolean {
  return consumedIdempotencyKeys.has(key);
}

/**
 * Check if an idempotency key has been consumed (persistent check).
 * For payment transitions, always use this to survive restarts.
 *
 * Checks the in-memory cache first — if the key is already there, we can
 * skip the DB round-trip entirely. The DB is consulted only for keys not in
 * the local cache so that keys consumed by a previous process instance (e.g.
 * before a server restart) are still detected.
 */
export async function isIdempotencyKeyConsumedPersistent(key: string): Promise<boolean> {
  // Fast path: in-memory cache already has it.
  if (consumedIdempotencyKeys.has(key)) return true;

  try {
    const { isIdempotencyKeyConsumedPersistent: checkDB } = await import('@/data/repository');
    const consumed = await checkDB(key);
    if (consumed) {
      // Warm the local cache so subsequent calls skip the DB.
      consumedIdempotencyKeys.add(key);
    }
    return consumed;
  } catch (error) {
    console.error('Failed to check idempotency key in DB:', error);
    // Fail safe: assume consumed if we can't check the DB
    return true;
  }
}

/**
 * Record an idempotency key consumption in persistent storage.
 * Call after a successful payment transition.
 */
export async function recordIdempotencyKeyConsumptionPersistent(
  key: string,
  claimId: string,
  actor: string,
): Promise<void> {
  try {
    const { recordIdempotencyKeyConsumption } = await import('@/data/repository');
    await recordIdempotencyKeyConsumption(key, claimId, actor);
    // Also update in-memory cache
    consumedIdempotencyKeys.add(key);
  } catch (error) {
    throw new Error(`Failed to record idempotency key consumption: ${error}`);
  }
}

/** Test/dev only — clears the in-memory consumed-key registry. */
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

  // Reject already-consumed idempotency keys on payment transitions.
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
