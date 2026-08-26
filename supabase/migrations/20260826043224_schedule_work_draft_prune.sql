select cron.unschedule('prune-finalized-work-drafts')
where exists (select 1 from cron.job where jobname = 'prune-finalized-work-drafts');

select cron.schedule(
  'prune-finalized-work-drafts',
  '23 3 * * *',
  $$ select public.prune_finalized_work_drafts(7); $$
);
