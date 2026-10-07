-- Client asked on 2026-10-07 for assist requests to stop auto-escalating.
-- The job can be restored with:
--   select cron.schedule('escalate-overdue-bathroom-assist', '*/5 * * * *',
--     'SELECT public.escalate_overdue_bathroom_assist_requests();');
select cron.unschedule('escalate-overdue-bathroom-assist')
where exists (select 1 from cron.job where jobname = 'escalate-overdue-bathroom-assist');

update public.bathroom_assist_requests
   set escalate_after = null
 where status in ('pending', 'accepted')
   and escalate_after is not null;
