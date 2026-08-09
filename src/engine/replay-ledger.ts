/**
 * Replay Ledger
 *
 * Cache + persistence pattern:
 * - In-memory array for performance (read-through cache)
 * - Supabase for durability (source of truth)
 *
 * Immutable audit history of:
 * - Original adjudications
 * - Replays
 * - Verification events
 * - Fingerprint creation
 * - Replay record persistence
 *
 * Deterministic event IDs.
 * No Date.now().
 * No global counters.
 *
 * Hash-chained events:
 * every event contains:
 * - prev_event_hash
 * - event_hash
 *
 * This makes tampering detectable.
 */

import { hashObject } from './hash';

const GENESIS_HASH = 'GENESIS';

export type ReplayLedgerEventType =
  | 'ADJUDICATION_CREATED'
  | 'SNAPSHOT_CREATED'
  | 'FINGERPRINT_CREATED'
  | 'REPLAY_RECORD_SAVED'
  | 'REPLAY_EXECUTED'
  | 'VERIFICATION_PASSED'
  | 'VERIFICATION_FAILED';

export interface ReplayLedgerEvent {
  event_id: string;

  type: ReplayLedgerEventType;

  claim_id: string;
  run_id?: string;
  snapshot_id?: string;

  actor: string;

  timestamp: string;

  prev_event_hash: string;
  event_hash: string;

  details: Record<string, unknown>;
}

export interface ReplayLedgerIntegrityResult {
  valid: boolean;
  broken_at_event_id?: string;
  expected_prev_hash?: string;
  actual_prev_hash?: string;
  expected_event_hash?: string;
  actual_event_hash?: string;
}

type NewLedgerEvent = Omit<
  ReplayLedgerEvent,
  'event_id' | 'prev_event_hash' | 'event_hash'
>;

const ledger: ReplayLedgerEvent[] = [];

let ledgerInitialized = false;

function latestEventHash(): string {
  return ledger.length > 0
    ? ledger[ledger.length - 1].event_hash
    : GENESIS_HASH;
}

async function createEventHash(
  event: NewLedgerEvent,
  prevEventHash: string,
): Promise<string> {
  return hashObject({
    type: event.type,
    claim_id: event.claim_id,
    run_id: event.run_id,
    snapshot_id: event.snapshot_id,
    actor: event.actor,
    timestamp: event.timestamp,
    prev_event_hash: prevEventHash,
    details: event.details,
  });
}

async function createLedgerId(
  eventHash: string,
): Promise<string> {
  return `ledger_${eventHash.slice(0, 16)}`;
}

/**
 * Initialize the replay ledger from persistent storage.
 * Call once on app startup.
 */
export async function initializeReplayLedger(): Promise<void> {
  if (ledgerInitialized) return;

  try {
    const { listLedgerEventsPersistent } = await import('@/data/repository');
    const events = await listLedgerEventsPersistent();
    
    ledger.length = 0;
    for (const event of events) {
      ledger.push(event);
    }

    ledgerInitialized = true;
  } catch (error) {
    console.error('Failed to initialize replay ledger from persistence:', error);
    ledgerInitialized = true; // Mark as initialized even on error to avoid retry loops
  }
}

/**
 * Append a ledger event to both cache and persistent storage.
 * Preserves hash chain for tampering detection.
 */
export async function appendLedgerEvent(
  event: NewLedgerEvent,
): Promise<ReplayLedgerEvent> {
  const prevEventHash = latestEventHash();
  const eventHash = await createEventHash(event, prevEventHash);

  // Internal (mutable) copy stored in the ledger so that verifyLedgerIntegrity()
  // can detect in-place tampering (e.g. in tests or via a compromised runtime).
  const internal: ReplayLedgerEvent = {
    event_id: await createLedgerId(eventHash),
    ...event,
    prev_event_hash: prevEventHash,
    event_hash: eventHash,
  };

  // Persist to DB
  try {
    const { appendLedgerEventPersistent } = await import('@/data/repository');
    await appendLedgerEventPersistent(internal);
  } catch (error) {
    throw new Error(`Failed to persist ledger event: ${error}`);
  }

  // Update cache — mutable so verifyLedgerIntegrity can detect tampering.
  ledger.push(internal);

  // Return a frozen snapshot to callers so they can't accidentally mutate the
  // canonical record via the return value.
  return Object.freeze({ ...internal });
}

/**
 * List all ledger events from cache (newest first).
 */
export function listLedgerEvents(): ReplayLedgerEvent[] {
  return [...ledger].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp),
  );
}

/**
 * List all ledger events from cache in append order (oldest first).
 */
export function listLedgerEventsInAppendOrder(): ReplayLedgerEvent[] {
  return [...ledger];
}

/**
 * List ledger events for a specific claim from cache.
 */
export function listLedgerEventsForClaim(
  claimId: string,
): ReplayLedgerEvent[] {
  return ledger
    .filter((event) => event.claim_id === claimId)
    .sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp),
    );
}

/**
 * List ledger events for a specific run from cache.
 */
export function listLedgerEventsForRun(
  runId: string,
): ReplayLedgerEvent[] {
  return ledger
    .filter((event) => event.run_id === runId)
    .sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp),
    );
}

/**
 * List ledger events for a specific snapshot from cache.
 */
export function listLedgerEventsForSnapshot(
  snapshotId: string,
): ReplayLedgerEvent[] {
  return ledger
    .filter((event) => event.snapshot_id === snapshotId)
    .sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp),
    );
}

/**
 * Get a single ledger event by ID from cache.
 */
export function getLedgerEvent(
  eventId: string,
): ReplayLedgerEvent | undefined {
  return ledger.find(
    (event) => event.event_id === eventId,
  );
}

/**
 * Verify the integrity of the ledger cache.
 * Checks hash chain continuity and event hash validity.
 */
export async function verifyLedgerIntegrity(): Promise<ReplayLedgerIntegrityResult> {
  let expectedPrevHash = GENESIS_HASH;

  for (const event of ledger) {
    if (event.prev_event_hash !== expectedPrevHash) {
      return {
        valid: false,
        broken_at_event_id: event.event_id,
        expected_prev_hash: expectedPrevHash,
        actual_prev_hash: event.prev_event_hash,
      };
    }

    const recalculatedEventHash = await createEventHash(
      {
        type: event.type,
        claim_id: event.claim_id,
        run_id: event.run_id,
        snapshot_id: event.snapshot_id,
        actor: event.actor,
        timestamp: event.timestamp,
        details: event.details,
      },
      event.prev_event_hash,
    );

    if (event.event_hash !== recalculatedEventHash) {
      return {
        valid: false,
        broken_at_event_id: event.event_id,
        expected_event_hash: recalculatedEventHash,
        actual_event_hash: event.event_hash,
      };
    }

    expectedPrevHash = event.event_hash;
  }

  return {
    valid: true,
  };
}

/**
 * Test/dev only.
 * Do not call this in production workflows.
 */
export function clearLedger(): void {
  ledger.length = 0;
  ledgerInitialized = false;
}
