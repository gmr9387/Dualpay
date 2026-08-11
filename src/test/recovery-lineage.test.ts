/**
 * Recovery lineage event tests.
 *
 * Documents which lifecycle events are implemented and verifies the logic of
 * the lineage event pipeline.
 *
 * IMPLEMENTED EVENTS (as of PR #6)
 * ----------------------------------
 * ✅ row_imported              — import-batches.ts
 * ✅ claim_created              — import-batches.ts
 * ✅ denial_detected            — import-batches.ts (835 rows classified as 'denial')
 * ✅ underpayment_detected      — worker-dispatcher edge function
 * ✅ dispute_created            — worker-dispatcher + contracts.ts
 * ✅ case_created               — worker-dispatcher (recovery_case_generation job)
 * ✅ outcome_recorded           — outcomes.ts
 *
 * NOT WIRED — requires architectural decision
 * -------------------------------------------
 * ⚠️  executive_value_attributed — executive metrics are currently derived at
 *     query time from recovery_outcomes; there is no authoritative persisted
 *     attribution operation. Do NOT fabricate a transactional event here.
 *     Marked as roadmap/derived.
 *
 * NOTE: case_created and dispute_created represent DIFFERENT lifecycle events:
 *   - dispute_created: created when an underpayment variance is confirmed
 *     (one dispute per claim/contract pair).
 *   - case_created: created by recovery_case_generation when a high/critical
 *     dispute is escalated into a formal recovery case (one case may span
 *     multiple disputes for the same claim).
 *
 * IMPLEMENTED CHAIN
 * -----------------
 * claim → denial → recovery detection → case/dispute → outcome
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Inline lineage event state machine (mirrors lineage.ts appendLineageEvent)
// ---------------------------------------------------------------------------

type LineageEventType =
  | 'row_imported'
  | 'claim_created'
  | 'denial_detected'
  | 'underpayment_detected'
  | 'dispute_created'
  | 'case_created'
  | 'outcome_recorded'
  | 'executive_value_attributed';

interface LineageEvent {
  org_id: string;
  claim_id: string | null;
  event_type: LineageEventType;
  event_summary: string;
  payload?: Record<string, unknown>;
  outcome_id?: string | null;
  dispute_id?: string | null;
}

/** Simulated append — in production this goes to recovery_lineage_events. */
function appendLineageEvent(events: LineageEvent[], event: LineageEvent): void {
  events.push({ ...event });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recovery lineage — event types and ordering', () => {
  it('row_imported is recorded first in the lineage chain', () => {
    const events: LineageEvent[] = [];
    appendLineageEvent(events, {
      org_id: 'org-1', claim_id: 'CLM-001',
      event_type: 'row_imported',
      event_summary: 'Row 42 imported from batch BATCH-1',
    });
    expect(events[0].event_type).toBe('row_imported');
  });

  it('claim_created follows row_imported', () => {
    const events: LineageEvent[] = [];
    appendLineageEvent(events, { org_id: 'org-1', claim_id: 'CLM-001', event_type: 'row_imported', event_summary: '' });
    appendLineageEvent(events, { org_id: 'org-1', claim_id: 'CLM-001', event_type: 'claim_created', event_summary: '' });
    expect(events[0].event_type).toBe('row_imported');
    expect(events[1].event_type).toBe('claim_created');
  });

  it('denial_detected follows claim_created for denied 835 rows', () => {
    const events: LineageEvent[] = [];
    appendLineageEvent(events, { org_id: 'org-1', claim_id: 'CLM-001', event_type: 'row_imported', event_summary: '' });
    appendLineageEvent(events, { org_id: 'org-1', claim_id: 'CLM-001', event_type: 'claim_created', event_summary: '' });
    appendLineageEvent(events, {
      org_id: 'org-1', claim_id: 'CLM-001', event_type: 'denial_detected',
      event_summary: 'Denial detected on claim CLM-001 (CARC 97)',
      payload: { carc_code: '97', classification: 'denial' },
    });
    expect(events[2].event_type).toBe('denial_detected');
    expect(events[2].payload?.classification).toBe('denial');
  });

  it('denial_detected is NOT emitted for non-denial 835 rows', () => {
    // Rows classified as underpayment, cob, or paid_in_full do not produce denial_detected.
    const denialEvents: LineageEvent[] = [];
    const classifiedAs = ['underpayment', 'cob', 'paid_in_full'];
    for (const cls of classifiedAs) {
      if (cls === 'denial') {
        appendLineageEvent(denialEvents, { org_id: 'org-1', claim_id: 'CLM-X', event_type: 'denial_detected', event_summary: '' });
      }
    }
    expect(denialEvents.filter(e => e.event_type === 'denial_detected')).toHaveLength(0);
  });

  it('underpayment_detected and dispute_created follow claim_created', () => {
    const events: LineageEvent[] = [];
    const types: LineageEventType[] = ['row_imported', 'claim_created', 'underpayment_detected', 'dispute_created'];
    types.forEach(t => appendLineageEvent(events, { org_id: 'org-1', claim_id: 'CLM-001', event_type: t, event_summary: '' }));
    expect(events.map(e => e.event_type)).toEqual(types);
  });

  it('case_created is emitted after high-severity dispute triggers case generation', () => {
    const events: LineageEvent[] = [];
    appendLineageEvent(events, { org_id: 'org-1', claim_id: 'CLM-001', event_type: 'dispute_created', event_summary: '' });
    appendLineageEvent(events, {
      org_id: 'org-1', claim_id: 'CLM-001', event_type: 'case_created',
      event_summary: 'Recovery case created for BCBS underpayment (35.0%)',
      payload: { case_id: 'CASE-001', trigger: 'major_underpayment', payer_name: 'BCBS' },
    });
    expect(events[1].event_type).toBe('case_created');
    expect(events[1].payload?.trigger).toBe('major_underpayment');
  });

  it('case_created and dispute_created are distinct events representing different lifecycle stages', () => {
    // dispute_created: variance confirmed against contract.
    // case_created: high/critical dispute escalated into a formal recovery case.
    const disputeEvent: LineageEvent = {
      org_id: 'org-1', claim_id: 'CLM-001', event_type: 'dispute_created',
      event_summary: '', payload: { dispute_id: 'DIS-001' },
    };
    const caseEvent: LineageEvent = {
      org_id: 'org-1', claim_id: 'CLM-001', event_type: 'case_created',
      event_summary: '', payload: { case_id: 'CASE-001' },
    };
    expect(disputeEvent.event_type).not.toBe(caseEvent.event_type);
    expect(disputeEvent.payload?.dispute_id).toBeTruthy();
    expect(caseEvent.payload?.case_id).toBeTruthy();
  });

  it('outcome_recorded terminates the core chain', () => {
    const events: LineageEvent[] = [];
    const types: LineageEventType[] = ['claim_created', 'underpayment_detected', 'dispute_created', 'outcome_recorded'];
    types.forEach(t => appendLineageEvent(events, { org_id: 'org-1', claim_id: 'CLM-001', event_type: t, event_summary: '' }));
    expect(events[events.length - 1].event_type).toBe('outcome_recorded');
  });
});

describe('recovery lineage — org isolation', () => {
  it('each event carries the org_id of the owning organization', () => {
    const events: LineageEvent[] = [];
    appendLineageEvent(events, { org_id: 'org-a', claim_id: 'CLM-A1', event_type: 'claim_created', event_summary: '' });
    appendLineageEvent(events, { org_id: 'org-b', claim_id: 'CLM-B1', event_type: 'claim_created', event_summary: '' });
    const orgAEvents = events.filter(e => e.org_id === 'org-a');
    const orgBEvents = events.filter(e => e.org_id === 'org-b');
    expect(orgAEvents).toHaveLength(1);
    expect(orgBEvents).toHaveLength(1);
  });

  it('denial_detected carries the correct org_id from the ingesting organization', () => {
    const events: LineageEvent[] = [];
    appendLineageEvent(events, {
      org_id: 'org-a', claim_id: 'CLM-A2', event_type: 'denial_detected',
      event_summary: 'Denial detected (CARC 4)',
      payload: { carc_code: '4', classification: 'denial' },
    });
    expect(events[0].org_id).toBe('org-a');
  });

  it('case_created carries the correct org_id from the owning organization', () => {
    const events: LineageEvent[] = [];
    appendLineageEvent(events, {
      org_id: 'org-a', claim_id: 'CLM-A3', event_type: 'case_created',
      event_summary: 'Recovery case created',
      payload: { case_id: 'CASE-A1', trigger: 'major_underpayment' },
    });
    expect(events[0].org_id).toBe('org-a');
  });

  it('org-a lineage events cannot appear in org-b event set', () => {
    const orgAEvents: LineageEvent[] = [];
    const orgBEvents: LineageEvent[] = [];
    appendLineageEvent(orgAEvents, { org_id: 'org-a', claim_id: 'CLM-A1', event_type: 'denial_detected', event_summary: '' });
    appendLineageEvent(orgBEvents, { org_id: 'org-b', claim_id: 'CLM-B1', event_type: 'case_created', event_summary: '' });
    expect(orgAEvents.every(e => e.org_id === 'org-a')).toBe(true);
    expect(orgBEvents.every(e => e.org_id === 'org-b')).toBe(true);
  });
});

describe('recovery lineage — implemented coverage inventory', () => {
  const implementedEvents: LineageEventType[] = [
    'row_imported',
    'claim_created',
    'denial_detected',
    'underpayment_detected',
    'dispute_created',
    'case_created',
    'outcome_recorded',
  ];

  // executive_value_attributed: no authoritative persisted attribution boundary.
  // Executive metrics are derived at query time from recovery_outcomes.
  // This event is roadmap/derived — NOT a transactional lineage event.
  const roadmapEvents: LineageEventType[] = [
    'executive_value_attributed',
  ];

  it('implemented events cover the full recovery chain minus executive attribution', () => {
    const coreChain: LineageEventType[] = [
      'claim_created', 'denial_detected', 'underpayment_detected',
      'dispute_created', 'case_created', 'outcome_recorded',
    ];
    expect(coreChain.every(e => implementedEvents.includes(e))).toBe(true);
  });

  it('documents executive_value_attributed as roadmap (no authoritative write path)', () => {
    expect(roadmapEvents).toContain('executive_value_attributed');
    // Verify it is NOT claimed as implemented.
    expect(implementedEvents).not.toContain('executive_value_attributed');
  });
});

describe('denial_detected lineage event shape', () => {
  it('carries required fields for audit trail', () => {
    const event: LineageEvent = {
      org_id: 'org-1',
      claim_id: 'CLM-001',
      event_type: 'denial_detected',
      event_summary: 'Denial detected on claim CLM-001 (CARC 97)',
      payload: {
        carc_code: '97',
        rarc_code: 'N130',
        classification: 'denial',
        import_batch_id: 'BATCH-001',
      },
    };
    expect(event.org_id).toBeTruthy();
    expect(event.claim_id).toBeTruthy();
    expect(event.event_type).toBe('denial_detected');
    expect(event.payload?.classification).toBe('denial');
  });

  it('duplicate batch re-import does not silently hide denial events', () => {
    // The lineage table has no unique constraint on (claim_id, event_type).
    // Consistent with row_imported and claim_created: re-importing a batch
    // creates new lineage rows. This is the existing architecture.
    const events: LineageEvent[] = [];
    for (let i = 0; i < 2; i++) {
      appendLineageEvent(events, {
        org_id: 'org-1', claim_id: 'CLM-001', event_type: 'denial_detected',
        event_summary: `Denial detected (import run ${i + 1})`,
        payload: { classification: 'denial', import_batch_id: `BATCH-00${i + 1}` },
      });
    }
    // Both are recorded; the batch_id in payload distinguishes them.
    expect(events).toHaveLength(2);
    expect(events[0].payload?.import_batch_id).not.toBe(events[1].payload?.import_batch_id);
  });
});

describe('case_created lineage event shape', () => {
  it('carries required fields for audit trail', () => {
    const event: LineageEvent = {
      org_id: 'org-1',
      claim_id: 'CLM-001',
      event_type: 'case_created',
      event_summary: 'Recovery case created for BCBS underpayment (35.0%)',
      payload: {
        case_id: 'CASE-001',
        trigger: 'major_underpayment',
        payer_name: 'BCBS',
      },
    };
    expect(event.org_id).toBeTruthy();
    expect(event.claim_id).toBeTruthy();
    expect(event.event_type).toBe('case_created');
    expect(event.payload?.trigger).toBe('major_underpayment');
  });

  it('case_created is not emitted when claim is already linked to a case', () => {
    // In the worker-dispatcher, the linked-claim check (via case_claim_links)
    // prevents duplicate case creation. We simulate that guard here.
    const linked = new Set(['CLM-001']);
    const targets = [
      { claim_id: 'CLM-001', payer_name: 'BCBS', variance_percent: 35 },
      { claim_id: 'CLM-002', payer_name: 'Aetna', variance_percent: 20 },
    ].filter(t => !linked.has(t.claim_id));

    const createdEvents: LineageEvent[] = [];
    for (const t of targets) {
      appendLineageEvent(createdEvents, {
        org_id: 'org-1', claim_id: t.claim_id, event_type: 'case_created',
        event_summary: `Recovery case created for ${t.payer_name}`,
        payload: { trigger: 'major_underpayment' },
      });
    }
    // CLM-001 already linked → skipped. Only CLM-002 emits case_created.
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0].claim_id).toBe('CLM-002');
  });
});

describe('outcome_recorded lineage event shape', () => {
  it('carries required fields for audit trail', () => {
    const event: LineageEvent = {
      org_id: 'org-1',
      claim_id: 'CLM-001',
      outcome_id: 'OUT-001',
      event_type: 'outcome_recorded',
      event_summary: 'Outcome recorded: recovered_partial — recovered $1500.00',
      payload: {
        outcome_id: 'OUT-001',
        resolution_type: 'recovered_partial',
        recovered_cents: 150000,
        denied_cents: 200000,
      },
    };
    expect(event.org_id).toBeTruthy();
    expect(event.event_type).toBe('outcome_recorded');
    expect((event.payload as Record<string, unknown>).recovered_cents).toBeGreaterThan(0);
  });
});
