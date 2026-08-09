/**
 * Phase 16 — Auto Case Generator.
 *
 * Persists a recovery case row (table: cases) and an initial case event when:
 *  - a high-severity denial is detected
 *  - a major underpayment is detected
 *  - a repeated payer issue is detected
 *
 * Reuses the existing case-management engine helper (createCaseEvent).
 * Does NOT duplicate the case domain model.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { createCaseEvent } from '@/engine/case-management';
import { appendOpsEvent } from '@/lib/ops-events';

const sb = supabase as ReturnType<typeof createClient>;

export type AutoCaseTrigger =
  | 'high_severity_denial'
  | 'major_underpayment'
  | 'repeat_payer_issue';

export interface AutoCaseInput {
  claim_id: string;
  member_id?: string;
  trigger: AutoCaseTrigger;
  description: string;
  tags?: string[];
}

export interface AutoCaseResult {
  case_id: string;
  trigger: AutoCaseTrigger;
  claim_id: string;
}

const TRIGGER_TAG: Record<AutoCaseTrigger, string> = {
  high_severity_denial: 'auto:denial',
  major_underpayment:   'auto:underpayment',
  repeat_payer_issue:   'auto:repeat-payer',
};

export async function autoCreateCase(input: AutoCaseInput): Promise<AutoCaseResult | null> {
  const tags = ['automation', TRIGGER_TAG[input.trigger], ...(input.tags ?? [])];

  const caseRow = {
    member_id: input.member_id ?? 'unknown',
    status: 'OPEN',
    claim_ids: [input.claim_id],
    description: input.description,
    tags,
  };
  const { data: created, error } = await sb.from('cases').insert([caseRow]).select('*').single();
  if (error || !created) {
    console.error('[auto-case] insert failed', error?.message);
    return null;
  }

  // Link claim → case in case_claim_links (best-effort; ignore conflict).
  await sb.from('case_claim_links').insert([{ case_id: created.case_id, claim_id: input.claim_id }]).then(
    () => {}, () => {},
  );

  // Initial event using existing engine helper.
  const evt = createCaseEvent(
    created.case_id, 'CASE_CREATED',
    `Auto-created case (${input.trigger}): ${input.description}`,
    input.claim_id,
    { source: 'automation', trigger: input.trigger },
  );
  await sb.from('case_events').insert([{
    event_id: evt.event_id,
    case_id: evt.case_id,
    timestamp: evt.timestamp,
    event_type: evt.event_type,
    claim_id: evt.claim_id ?? null,
    description: evt.description,
    metadata: evt.metadata as never,
  }]).then(() => {}, () => {});

  await appendOpsEvent({
    kind: 'case_auto_created',
    claim_id: input.claim_id,
    summary: `Case auto-created: ${input.trigger}`,
    payload: { case_id: created.case_id, trigger: input.trigger },
  });

  return { case_id: created.case_id, trigger: input.trigger, claim_id: input.claim_id };
}
