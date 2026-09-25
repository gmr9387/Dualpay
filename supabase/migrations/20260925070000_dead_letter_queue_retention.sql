-- Risk #25 (docs/RISK_REGISTER.md): dead-letter queue grows unbounded.
-- Manual replay/inspect/archive already existed (src/engine/dead-letter-queue.ts:
-- listDeadLetterJobs/inspectFailure/archiveFailure/reviveDeadLetter) -- what
-- was actually missing, verified by reading that file and the live schema,
-- was retention and an alert threshold.
--
-- reap_dead_letter_queue():
--  1. Alert threshold -- for each org with more than p_alert_threshold
--     *unarchived* job_failures rows, emit a single ops_event so it surfaces
--     in that org's own audit trail / AdminSecurity view. Not a new
--     third-party alerting integration -- this repo already treats
--     ops_events as its observability log (see reap_stuck_queue_messages'
--     sibling in valtaris-nucleus for the same idiom), so this reuses it
--     rather than inventing a new channel.
--  2. Retention -- hard-deletes job_queue rows that reached the terminal
--     'dead_letter' status more than p_retention_days ago, and job_failures
--     rows an operator already archived (archived = true) more than
--     p_retention_days ago. Never touches an unarchived failure -- those
--     are still someone's open investigation, not a candidate for cleanup,
--     no matter how old.
create or replace function dualpay.reap_dead_letter_queue(
  p_alert_threshold integer default 50,
  p_retention_days integer default 90
)
returns table(orgs_alerted integer, queue_rows_purged integer, failure_rows_purged integer)
language plpgsql
security definer
set search_path to 'dualpay'
as $$
declare
  v_orgs_alerted integer := 0;
  v_queue_purged integer := 0;
  v_failures_purged integer := 0;
  r record;
begin
  for r in
    select org_id, count(*) as backlog
    from dualpay.job_failures
    where archived = false
    group by org_id
    having count(*) > p_alert_threshold
  loop
    insert into dualpay.ops_events (org_id, kind, summary, payload)
    values (
      r.org_id,
      'job_dead_letter_threshold_exceeded',
      format('Dead-letter backlog for this organization has %s unarchived failures (threshold %s)', r.backlog, p_alert_threshold),
      jsonb_build_object('backlog', r.backlog, 'threshold', p_alert_threshold)
    );
    v_orgs_alerted := v_orgs_alerted + 1;
  end loop;

  with purged as (
    delete from dualpay.job_queue
    where status = 'dead_letter'
      and completed_at is not null
      and completed_at < now() - make_interval(days => p_retention_days)
    returning 1
  )
  select count(*) into v_queue_purged from purged;

  with purged as (
    delete from dualpay.job_failures
    where archived = true
      and created_at < now() - make_interval(days => p_retention_days)
    returning 1
  )
  select count(*) into v_failures_purged from purged;

  return query select v_orgs_alerted, v_queue_purged, v_failures_purged;
end;
$$;

comment on function dualpay.reap_dead_letter_queue is
  'Alerts (via ops_events) orgs whose unarchived job_failures backlog exceeds p_alert_threshold, then purges job_queue dead_letter rows and archived job_failures rows older than p_retention_days. Scheduled daily via pg_cron.';

revoke all on function dualpay.reap_dead_letter_queue(integer, integer) from public, anon, authenticated;
grant execute on function dualpay.reap_dead_letter_queue(integer, integer) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'reap-dualpay-dead-letter-queue') then
    perform cron.unschedule('reap-dualpay-dead-letter-queue');
  end if;
end $$;

select cron.schedule(
  'reap-dualpay-dead-letter-queue',
  '0 4 * * *',
  $$select dualpay.reap_dead_letter_queue();$$
);
