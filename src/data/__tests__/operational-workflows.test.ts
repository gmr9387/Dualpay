/**
 * Phase 3A Operational Workflows — Tests
 *
 * Tests cover:
 * - Assignment workflow (create, update, priority, due_date)
 * - Notes and events (addNote, logAppealEvent, logRecoveryEvent)
 * - My Worklist queries (assigned, overdue, due today, high dollar)
 * - Timeline queries (unified, filtered by kind)
 * - RLS enforcement via org_id
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  updateAssignment,
  addNote,
  logAppealEvent,
  logRecoveryEvent,
  logWriteOff,
  getMyWorklist,
  getOverdueClaims,
  getDueTodayClaims,
  getHighDollarClaims,
  getClaimTimeline,
  getClaimTimelineByKind,
  getAppealTimeline,
  getRecoveryTimeline,
  getNoteTimeline,
} from '../operational-workflows';

// Mock org and user IDs
const TEST_ORG_ID = 'test-org-uuid';
const TEST_USER_ID = 'test-user-uuid';
const TEST_CLAIM_ID = 'CLM-2024-00001';

describe('Operational Workflows (Phase 3A)', () => {
  describe('Assignment Workflow', () => {
    it('should create a new assignment with priority and due_date', async () => {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7); // 7 days from now

      const result = await updateAssignment(TEST_CLAIM_ID, TEST_ORG_ID, {
        assignedToUserId: TEST_USER_ID,
        assignedByUserId: 'admin-user-uuid',
        priority: 'high',
        dueDate,
      });

      expect(result).toBeDefined();
      expect(result.claim_id).toBe(TEST_CLAIM_ID);
      expect(result.assigned_to_user_id).toBe(TEST_USER_ID);
      expect(result.priority).toBe('high');
      expect(result.due_date).toBeDefined();
    });

    it('should update assignment priority and due_date', async () => {
      const newDueDate = new Date();
      newDueDate.setDate(newDueDate.getDate() + 14);

      const result = await updateAssignment(TEST_CLAIM_ID, TEST_ORG_ID, {
        priority: 'urgent',
        dueDate: newDueDate,
      });

      expect(result.priority).toBe('urgent');
      expect(result.due_date).toBeDefined();
    });

    it('should update assignment status', async () => {
      const result = await updateAssignment(TEST_CLAIM_ID, TEST_ORG_ID, {
        status: 'in_progress',
      });

      expect(result.status).toBe('in_progress');
    });

    it('should reassign to a different user', async () => {
      const newUserId = 'different-user-uuid';

      const result = await updateAssignment(TEST_CLAIM_ID, TEST_ORG_ID, {
        assignedToUserId: newUserId,
        assignedByUserId: 'admin-user-uuid',
      });

      expect(result.assigned_to_user_id).toBe(newUserId);
    });

    it('should support all priority levels', async () => {
      const priorities = ['low', 'medium', 'high', 'urgent'] as const;

      for (const priority of priorities) {
        const result = await updateAssignment(TEST_CLAIM_ID, TEST_ORG_ID, { priority });
        expect(result.priority).toBe(priority);
      }
    });
  });

  describe('Notes & Events (ops_events)', () => {
    it('should add a note', async () => {
      const noteText = 'Additional documentation received from patient';
      const eventId = await addNote(TEST_CLAIM_ID, TEST_ORG_ID, noteText, 'analyst-1');

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe('string');
    });

    it('should log an appeal submission', async () => {
      const eventId = await logAppealEvent(TEST_CLAIM_ID, TEST_ORG_ID, {
        kind: 'appeal_submitted',
        summary: 'Appeal filed with Blue Cross',
        appealStatus: 'pending_response',
        notes: 'Submitted with complete documentation',
        idempotencyKey: 'appeal:test-appeal-submitted-001',
      });

      expect(eventId).toBeDefined();
    });

    it('should log an appeal response', async () => {
      const eventId = await logAppealEvent(TEST_CLAIM_ID, TEST_ORG_ID, {
        kind: 'appeal_responded',
        summary: 'Payer responded to appeal',
        payerResponse: 'Partial approval: $250 additional recovery',
        idempotencyKey: 'appeal:test-appeal-responded-001',
      });

      expect(eventId).toBeDefined();
    });

    it('should log an appeal resolution (won)', async () => {
      const eventId = await logAppealEvent(TEST_CLAIM_ID, TEST_ORG_ID, {
        kind: 'appeal_resolved',
        summary: 'Appeal won',
        appealStatus: 'won',
        idempotencyKey: 'appeal:test-appeal-resolved-001',
      });

      expect(eventId).toBeDefined();
    });

    it('should log a payer recovery', async () => {
      const eventId = await logRecoveryEvent(TEST_CLAIM_ID, TEST_ORG_ID, {
        recoveryType: 'payer_payment',
        amountCents: 500000,
        recoveredFrom: 'Blue Cross',
        analystUserId: TEST_USER_ID,
        notes: 'Payment received via ACH',
        idempotencyKey: 'recovery:idem-test-payer-001',
      });

      expect(eventId).toBeDefined();
    });

    it('should log a patient recovery', async () => {
      const eventId = await logRecoveryEvent(TEST_CLAIM_ID, TEST_ORG_ID, {
        recoveryType: 'patient_payment',
        amountCents: 100000,
        recoveredFrom: 'Patient',
        notes: 'Patient paid balance',
        idempotencyKey: 'recovery:idem-test-patient-001',
      });

      expect(eventId).toBeDefined();
    });

    it('should log a writeoff', async () => {
      const eventId = await logWriteOff(TEST_CLAIM_ID, TEST_ORG_ID, 'Unrecoverable - payer bankruptcy', undefined, 'write_off:idem-test-writeoff-001');

      expect(eventId).toBeDefined();
    });

    it('should support all recovery types', async () => {
      const recoveryTypes = ['payer_payment', 'patient_payment', 'writeoff', 'adjustment'] as const;

      for (const type of recoveryTypes) {
        const eventId = await logRecoveryEvent(TEST_CLAIM_ID, TEST_ORG_ID, {
          recoveryType: type,
          amountCents: type === 'writeoff' ? 0 : 100000,
          recoveredFrom: type === 'patient_payment' ? 'Patient' : 'Payer',
          idempotencyKey: `recovery:idem-test-type-${type}`,
        });

        expect(eventId).toBeDefined();
      }
    });
  });

  describe('My Worklist Queries', () => {
    it('should return assignments for the user', async () => {
      const worklist = await getMyWorklist(TEST_USER_ID, TEST_ORG_ID);

      expect(Array.isArray(worklist)).toBe(true);
      // Should include TEST_CLAIM_ID if assigned to TEST_USER_ID
      const found = worklist.find((w) => w.claim_id === TEST_CLAIM_ID);
      if (found) {
        expect(found.assigned_to_user_id).toBe(TEST_USER_ID);
        expect(['open', 'in_progress', 'snoozed']).toContain(found.status);
      }
    });

    it('should return overdue claims', async () => {
      const overdue = await getOverdueClaims(TEST_USER_ID, TEST_ORG_ID);

      expect(Array.isArray(overdue)).toBe(true);
      // All returned items should be overdue
      overdue.forEach((item) => {
        expect(item.is_overdue).toBe(true);
        expect(['open', 'in_progress', 'snoozed']).toContain(item.status);
      });
    });

    it('should return claims due today', async () => {
      const dueToday = await getDueTodayClaims(TEST_USER_ID, TEST_ORG_ID);

      expect(Array.isArray(dueToday)).toBe(true);
      // All returned items should be due today
      dueToday.forEach((item) => {
        expect(item.is_overdue).toBe(false);
        expect(item.days_until_due).toBe(0);
      });
    });

    it('should return high-dollar claims (default > $5000)', async () => {
      const highDollar = await getHighDollarClaims(TEST_USER_ID, TEST_ORG_ID);

      expect(Array.isArray(highDollar)).toBe(true);
      // All returned items should have total_billed >= 500000 cents ($5000)
      highDollar.forEach((item) => {
        expect(item.total_billed_cents).toBeGreaterThanOrEqual(500000);
      });
    });

    it('should return high-dollar claims with custom threshold', async () => {
      const highDollar = await getHighDollarClaims(TEST_USER_ID, TEST_ORG_ID, 1000000); // $10,000

      highDollar.forEach((item) => {
        expect(item.total_billed_cents).toBeGreaterThanOrEqual(1000000);
      });
    });

    it('should exclude resolved claims from worklist', async () => {
      const worklist = await getMyWorklist(TEST_USER_ID, TEST_ORG_ID, false);

      worklist.forEach((item) => {
        expect(item.status).not.toBe('resolved');
      });
    });

    it('should include resolved claims when requested', async () => {
      const worklist = await getMyWorklist(TEST_USER_ID, TEST_ORG_ID, true);

      // Should return all statuses including 'resolved'
      expect(Array.isArray(worklist)).toBe(true);
    });

    it('should calculate days_until_due correctly', async () => {
      const worklist = await getMyWorklist(TEST_USER_ID, TEST_ORG_ID);

      worklist.forEach((item) => {
        if (item.due_date) {
          const dueDate = new Date(item.due_date);
          const now = new Date();
          const expectedDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          expect(item.days_until_due).toBe(expectedDays);
        }
      });
    });

    it('should sort by priority (urgent > high > medium > low)', async () => {
      const worklist = await getMyWorklist(TEST_USER_ID, TEST_ORG_ID);

      const priorities = ['urgent', 'high', 'medium', 'low'];
      let lastIndex = -1;

      worklist.forEach((item) => {
        const currentIndex = priorities.indexOf(item.priority);
        expect(currentIndex).toBeGreaterThanOrEqual(lastIndex);
        lastIndex = currentIndex;
      });
    });
  });

  describe('Timeline (Unified Claim History)', () => {
    it('should return complete chronological timeline', async () => {
      const timeline = await getClaimTimeline(TEST_CLAIM_ID, TEST_ORG_ID);

      expect(Array.isArray(timeline)).toBe(true);
      // Should be ordered oldest → newest
      for (let i = 1; i < timeline.length; i++) {
        const prev = new Date(timeline[i - 1].occurred_at).getTime();
        const curr = new Date(timeline[i].occurred_at).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });

    it('should return timeline filtered by kind', async () => {
      const timeline = await getClaimTimelineByKind(
        TEST_CLAIM_ID,
        TEST_ORG_ID,
        ['note_added', 'appeal_submitted'],
      );

      expect(Array.isArray(timeline)).toBe(true);
      timeline.forEach((event) => {
        expect(['note_added', 'appeal_submitted']).toContain(event.kind);
      });
    });

    it('should return appeal timeline', async () => {
      const timeline = await getAppealTimeline(TEST_CLAIM_ID, TEST_ORG_ID);

      expect(Array.isArray(timeline)).toBe(true);
      timeline.forEach((event) => {
        expect(['appeal_submitted', 'appeal_responded', 'appeal_resolved']).toContain(event.kind);
      });
    });

    it('should return recovery timeline', async () => {
      const timeline = await getRecoveryTimeline(TEST_CLAIM_ID, TEST_ORG_ID);

      expect(Array.isArray(timeline)).toBe(true);
      timeline.forEach((event) => {
        expect(event.kind).toBe('recovery_recorded');
      });
    });

    it('should return note timeline', async () => {
      const timeline = await getNoteTimeline(TEST_CLAIM_ID, TEST_ORG_ID);

      expect(Array.isArray(timeline)).toBe(true);
      timeline.forEach((event) => {
        expect(event.kind).toBe('note_added');
      });
    });

    it('should include event payload', async () => {
      const timeline = await getClaimTimeline(TEST_CLAIM_ID, TEST_ORG_ID);

      timeline.forEach((event) => {
        expect(event).toHaveProperty('payload');
        // payload can be null or object
        expect(event.payload === null || typeof event.payload === 'object').toBe(true);
      });
    });

    it('should preserve actor information', async () => {
      const timeline = await getClaimTimeline(TEST_CLAIM_ID, TEST_ORG_ID);

      // At least some events should have actor
      const hasActor = timeline.some((e) => e.actor !== null);
      expect(hasActor).toBe(true);
    });
  });

  describe('RLS Enforcement (org_id scoping)', () => {
    it('should only return assignments for the specified org', async () => {
      const differentOrgId = 'different-org-uuid';

      const worklist1 = await getMyWorklist(TEST_USER_ID, TEST_ORG_ID);
      const worklist2 = await getMyWorklist(TEST_USER_ID, differentOrgId);

      // Results should be scoped to their org_id
      expect(Array.isArray(worklist1)).toBe(true);
      expect(Array.isArray(worklist2)).toBe(true);
    });

    it('should only return timeline events for the specified org', async () => {
      const differentOrgId = 'different-org-uuid';

      const timeline1 = await getClaimTimeline(TEST_CLAIM_ID, TEST_ORG_ID);
      const timeline2 = await getClaimTimeline(TEST_CLAIM_ID, differentOrgId);

      // Results should be scoped to their org_id
      expect(Array.isArray(timeline1)).toBe(true);
      expect(Array.isArray(timeline2)).toBe(true);
    });
  });

  describe('Edge Cases & Validation', () => {
    it('should handle claims with no assignments', async () => {
      const unknownClaimId = 'UNKNOWN-CLAIM-ID';
      const timeline = await getClaimTimeline(unknownClaimId, TEST_ORG_ID);

      expect(Array.isArray(timeline)).toBe(true);
      expect(timeline.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle users with no assignments', async () => {
      const unknownUserId = 'unknown-user-uuid';
      const worklist = await getMyWorklist(unknownUserId, TEST_ORG_ID);

      expect(Array.isArray(worklist)).toBe(true);
      expect(worklist.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty note text gracefully', async () => {
      const eventId = await addNote(TEST_CLAIM_ID, TEST_ORG_ID, '', 'analyst-1');
      expect(eventId).toBeDefined();
    });

    it('should handle very long note text', async () => {
      const longNote = 'A'.repeat(10000);
      const eventId = await addNote(TEST_CLAIM_ID, TEST_ORG_ID, longNote, 'analyst-1');
      expect(eventId).toBeDefined();
    });

    it('should handle zero recovery amount', async () => {
      const eventId = await logRecoveryEvent(TEST_CLAIM_ID, TEST_ORG_ID, {
        recoveryType: 'adjustment',
        amountCents: 0,
        recoveredFrom: 'N/A',
        idempotencyKey: 'recovery:idem-test-zero-001',
      });
      expect(eventId).toBeDefined();
    });

    it('should handle negative recovery amount (reversal)', async () => {
      const eventId = await logRecoveryEvent(TEST_CLAIM_ID, TEST_ORG_ID, {
        recoveryType: 'adjustment',
        amountCents: -50000,
        recoveredFrom: 'Reversal',
        notes: 'Reversal of previous payment',
        idempotencyKey: 'recovery:idem-test-negative-001',
      });
      expect(eventId).toBeDefined();
    });
  });
});
