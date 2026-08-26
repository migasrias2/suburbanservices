-- Hourly sweep. Hourly rather than nightly so a shift that ran away at 02:00
-- is caught the same morning, while the cleaner can still remember it.
select cron.unschedule('close-runaway-shifts')
where exists (select 1 from cron.job where jobname = 'close-runaway-shifts');

select cron.schedule(
  'close-runaway-shifts',
  '7 * * * *',
  $$
    select public.close_runaway_shifts(12);
    select public.flag_overlong_shifts(12);
  $$
);
