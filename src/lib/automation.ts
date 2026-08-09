/**
 * Phase 16 — Automation persistence layer.
 * CRUD for automation_jobs + automation_rules.  Reuses appendOpsEvent for audit.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { appendOpsEvent } from '@/lib/ops-events';
import type {
  AutomationJob, AutomationRule, JobStatus, JobType, JobRunResult, RuleTriggerType,
} from '@/types/automation';

const sb = supabase as ReturnType<typeof createClient>;

export const AUTOMATION_EVENT = 'clarity-automation';
function notify() { window.dispatchEvent(new Event(AUTOMATION_EVENT)); }

// ---------- Jobs ----------

export async function listJobs(limit = 200): Promise<AutomationJob[]> {
  const { data, error } = await sb.from('automation_jobs').select('*')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) { console.error('[automation] list jobs failed', error.message); return []; }
  return (data ?? []) as AutomationJob[];
}

export async function listJobsByPipeline(pipeline_id: string): Promise<AutomationJob[]> {
  const { data, error } = await sb.from('automation_jobs').select('*')
    .eq('pipeline_id', pipeline_id).order('created_at', { ascending: true });
  if (error) { console.error('[automation] pipeline jobs failed', error.message); return []; }
  return (data ?? []) as AutomationJob[];
}

export async function startJob(
  job_type: JobType,
  options: { pipeline_id?: string; parent_job_id?: string; config?: Record<string, unknown> } = {},
): Promise<AutomationJob | null> {
  const row = {
    job_type,
    status: 'running' as JobStatus,
    started_at: new Date().toISOString(),
    pipeline_id: options.pipeline_id ?? null,
    parent_job_id: options.parent_job_id ?? null,
    config: (options.config ?? null) as never,
  };
  const { data, error } = await sb.from('automation_jobs').insert([row]).select('*').single();
  if (error || !data) { console.error('[automation] start job failed', error?.message); return null; }
  await appendOpsEvent({
    kind: 'job_started',
    summary: `Job started: ${job_type}`,
    payload: { job_id: data.job_id, pipeline_id: options.pipeline_id ?? null },
  });
  notify();
  return data as AutomationJob;
}

export async function completeJob(
  job_id: string, result: JobRunResult,
): Promise<AutomationJob | null> {
  const patch = {
    status: 'completed' as JobStatus,
    completed_at: new Date().toISOString(),
    records_processed: result.records_processed,
    records_succeeded: result.records_succeeded,
    records_failed: result.records_failed,
    recovery_value_cents: result.recovery_value_cents ?? 0,
    result: (result.details ?? null) as never,
  };
  const { data, error } = await sb.from('automation_jobs')
    .update(patch).eq('job_id', job_id).select('*').single();
  if (error) { console.error('[automation] complete job failed', error.message); return null; }
  await appendOpsEvent({
    kind: 'job_completed',
    summary: `Job completed: ${data.job_type} (${result.records_succeeded}/${result.records_processed})`,
    payload: {
      job_id, recovery_value_cents: result.recovery_value_cents ?? 0,
      records_failed: result.records_failed,
    },
  });
  notify();
  return data as AutomationJob;
}

export async function failJob(job_id: string, error_summary: string): Promise<void> {
  await sb.from('automation_jobs').update({
    status: 'failed', completed_at: new Date().toISOString(), error_summary,
  }).eq('job_id', job_id);
  await appendOpsEvent({
    kind: 'job_failed',
    summary: `Job failed: ${error_summary}`,
    payload: { job_id },
  });
  notify();
}

// ---------- Rules ----------

export async function listRules(): Promise<AutomationRule[]> {
  const { data, error } = await sb.from('automation_rules').select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('[automation] list rules failed', error.message); return []; }
  return (data ?? []) as AutomationRule[];
}

export async function createRule(input: {
  rule_name: string; description?: string;
  trigger_type: RuleTriggerType;
  configuration?: Record<string, unknown>;
  enabled?: boolean;
}): Promise<AutomationRule | null> {
  const row = {
    rule_name: input.rule_name,
    description: input.description ?? null,
    trigger_type: input.trigger_type,
    configuration: (input.configuration ?? {}) as never,
    enabled: input.enabled ?? true,
  };
  const { data, error } = await sb.from('automation_rules').insert([row]).select('*').single();
  if (error || !data) { console.error('[automation] create rule failed', error?.message); return null; }
  notify();
  return data as AutomationRule;
}

export async function setRuleEnabled(rule_id: string, enabled: boolean): Promise<void> {
  const { error } = await sb.from('automation_rules').update({ enabled }).eq('rule_id', rule_id);
  if (error) console.error('[automation] toggle rule failed', error.message);
  else notify();
}

export async function deleteRule(rule_id: string): Promise<void> {
  const { error } = await sb.from('automation_rules').delete().eq('rule_id', rule_id);
  if (error) console.error('[automation] delete rule failed', error.message);
  else notify();
}

export async function incrementRuleTrigger(rule_id: string): Promise<void> {
  // Best-effort counter increment via fetch + update.
  const { data } = await sb.from('automation_rules').select('trigger_count').eq('rule_id', rule_id).maybeSingle();
  const next = ((data?.trigger_count as number | undefined) ?? 0) + 1;
  await sb.from('automation_rules').update({
    trigger_count: next, last_triggered_at: new Date().toISOString(),
  }).eq('rule_id', rule_id);
}
