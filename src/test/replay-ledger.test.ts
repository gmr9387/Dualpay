import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  appendLedgerEvent,
  listLedgerEventsInAppendOrder,
  listLedgerEventsForClaim,
  verifyLedgerIntegrity,
  clearLedger,
  type ReplayLedgerEventType,
} from '@/engine/replay-ledger';

// Test fixtures
function makeLedgerEvent(overrides: { 
  type?: ReplayLedgerEventType;
  claim_id?: string;
  timestamp?: string;
  actor?: string;
} = {}) {
  return {
    type: overrides.type ?? 'ADJUDICATION_CREATED',
    claim_id: overrides.claim_id ?? 'CLM-001',
    run_id: `run_${Math.random().toString(36).slice(2)}`,
    actor: overrides.actor ?? 'system',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    details: { test: true },
  };
}

describe('Replay Ledger — Persistence', () => {
  beforeEach(() => {
    clearLedger();
  });

  afterEach(() => {
    clearLedger();
  });

  describe('Append and List', () => {
    it('appends an event to ledger', async () => {
      const event = makeLedgerEvent();
      const appended = await appendLedgerEvent(event);
      
      expect(appended.event_id).toBeTruthy();
      expect(appended.event_hash).toBeTruthy();
      expect(appended.prev_event_hash).toBe('GENESIS');
    });

    it('lists events in append order', async () => {
      const event1 = makeLedgerEvent({ timestamp: '2024-01-01T00:00:00Z' });
      const event2 = makeLedgerEvent({ timestamp: '2024-01-02T00:00:00Z' });
      
      await appendLedgerEvent(event1);
      await appendLedgerEvent(event2);
      
      const list = listLedgerEventsInAppendOrder();
      expect(list).toHaveLength(2);
      expect(list[0].timestamp).toBe('2024-01-01T00:00:00Z');
      expect(list[1].timestamp).toBe('2024-01-02T00:00:00Z');
    });

    it('lists events for specific claim', async () => {
      const event1 = makeLedgerEvent({ claim_id: 'CLM-001' });
      const event2 = makeLedgerEvent({ claim_id: 'CLM-002' });
      const event3 = makeLedgerEvent({ claim_id: 'CLM-001' });
      
      await appendLedgerEvent(event1);
      await appendLedgerEvent(event2);
      await appendLedgerEvent(event3);
      
      const forClaim1 = listLedgerEventsForClaim('CLM-001');
      expect(forClaim1).toHaveLength(2);
      expect(forClaim1.every(e => e.claim_id === 'CLM-001')).toBe(true);
    });
  });

  describe('Hash Chain Integrity', () => {
    it('creates valid hash chain', async () => {
      const event1 = makeLedgerEvent();
      const event2 = makeLedgerEvent();
      
      const appended1 = await appendLedgerEvent(event1);
      const appended2 = await appendLedgerEvent(event2);
      
      expect(appended2.prev_event_hash).toBe(appended1.event_hash);
    });

    it('verifies ledger integrity when valid', async () => {
      const event1 = makeLedgerEvent();
      const event2 = makeLedgerEvent();
      const event3 = makeLedgerEvent();
      
      await appendLedgerEvent(event1);
      await appendLedgerEvent(event2);
      await appendLedgerEvent(event3);
      
      const result = await verifyLedgerIntegrity();
      expect(result.valid).toBe(true);
    });

    it('detects broken prev_event_hash', async () => {
      const event1 = makeLedgerEvent();
      const appended1 = await appendLedgerEvent(event1);
      
      const event2 = makeLedgerEvent();
      const appended2 = await appendLedgerEvent(event2);
      
      // Corrupt the ledger in memory (dev/test only)
      const ledgerEvents = listLedgerEventsInAppendOrder();
      if (ledgerEvents[1]) {
        (ledgerEvents[1] as Record<string, unknown>).prev_event_hash = 'CORRUPTED_HASH';
      }
      
      const result = await verifyLedgerIntegrity();
      expect(result.valid).toBe(false);
      expect(result.broken_at_event_id).toBe(appended2.event_id);
    });

    it('detects broken event_hash', async () => {
      const event1 = makeLedgerEvent();
      await appendLedgerEvent(event1);
      
      const event2 = makeLedgerEvent();
      const appended2 = await appendLedgerEvent(event2);
      
      // Corrupt the event hash (dev/test only)
      const ledgerEvents = listLedgerEventsInAppendOrder();
      if (ledgerEvents[1]) {
        (ledgerEvents[1] as Record<string, unknown>).event_hash = 'CORRUPTED_EVENT_HASH';
      }
      
      const result = await verifyLedgerIntegrity();
      expect(result.valid).toBe(false);
      expect(result.broken_at_event_id).toBe(appended2.event_id);
    });
  });

  describe('Event Immutability', () => {
    it('freezes appended events', async () => {
      const event = makeLedgerEvent();
      const appended = await appendLedgerEvent(event);
      
      expect(Object.isFrozen(appended)).toBe(true);
    });

    it('prevents modification of frozen events', async () => {
      const event = makeLedgerEvent();
      const appended = await appendLedgerEvent(event);
      
      expect(() => {
        (appended as Record<string, unknown>).event_id = 'MODIFIED';
      }).toThrow();
    });
  });

  describe('Multiple Events', () => {
    it('handles 10 sequential events', async () => {
      for (let i = 0; i < 10; i++) {
        await appendLedgerEvent(makeLedgerEvent({ timestamp: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
      }
      
      const result = await verifyLedgerIntegrity();
      expect(result.valid).toBe(true);
      
      const list = listLedgerEventsInAppendOrder();
      expect(list).toHaveLength(10);
    });
  });

  describe('Event Filtering', () => {
    it('filters by claim correctly', async () => {
      const claimCounts = new Map<string, number>();
      
      for (let i = 0; i < 5; i++) {
        const claimId = i % 2 === 0 ? 'CLM-A' : 'CLM-B';
        await appendLedgerEvent(makeLedgerEvent({ claim_id: claimId }));
        claimCounts.set(claimId, (claimCounts.get(claimId) ?? 0) + 1);
      }
      
      for (const [claimId, expectedCount] of claimCounts.entries()) {
        const events = listLedgerEventsForClaim(claimId);
        expect(events).toHaveLength(expectedCount);
      }
    });
  });
});
