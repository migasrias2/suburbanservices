-- P5 lockdown: the phone can no longer write time_attendance directly.
--
-- Applied 4 Nov 2026 at Miguel's request ("do the rest"), the same night the
-- new clock went live, rather than after the planned 14 quiet days. At apply time
-- there were 0 direct client writes since the old-app tag existed and nobody had
-- clocked since the deploy. A phone tab still running the old app gets an error on
-- its next clock and is fixed by reloading the page (no service worker).
-- Gate as coded: no direct client
-- write to time_attendance (no clock_in_source / close_source = 'legacy_client'),
-- clock_v2 and scanner_v2 on for everyone, no open P3/P4 bugs.
-- The block below refuses to run if the gate isn't met.
--
-- What it does:
--   1. Signed-in users can no longer INSERT/UPDATE/DELETE time_attendance
--      directly. Every write goes through a SECURITY DEFINER function owned by
--      postgres, which is unaffected by these grants:
--        clock_in / clock_out            (cleaners, ops managers)
--        set_shift_clock_out             (manager correction, ShiftReviewQueue)
--        flag_own_shift                  (cleaner "these hours look wrong")
--        admin_rename_customer           (admin rename, rewrites customer_name)
--        manager_delete_cleaner          (deletes a cleaner's shifts)
--        close_runaway_shifts / flag_overlong_shifts (cron, postgres)
--      Service-role tools ("Aside") keep their grants.
--      Checked 5 Nov 2026: the only direct writes in src/ are the legacy
--      clock-in insert and clock-out update in qrService.logClockEvent, which
--      P3 put behind clock_v2 and P6 deletes. No Edge Function touches the table.
--   2. Drops the legacy "Duplicate clock-in" trigger (D12: kept until P5). The
--      one-open-shift index and clock_in() replace it.
--   3. SELECT is unchanged here (D14 timesheet privacy is a separate decision).
--
-- Not included on purpose: revoking INSERT on clock_event_failures. P2 did not
-- build report_clock_problem(), so the app still reports camera/decode failures
-- there. Revoke it only once that replacement exists.
--
-- Rollback (one statement each, run together):
--   grant insert, update, delete on public.time_attendance to authenticated;
--   create trigger trg_prevent_duplicate_clock_in before insert on public.time_attendance
--     for each row execute function public.prevent_duplicate_clock_in();

begin;

do $$
declare v_legacy integer;
begin
  select count(*) into v_legacy
  from public.time_attendance
  where (clock_in_source = 'legacy_client' and clock_in > now() - interval '14 days')
     or (close_source = 'legacy_client' and clock_out > now() - interval '14 days');
  if v_legacy > 0 then
    raise exception 'P5 gate not met: % direct client writes to time_attendance in the last 14 days', v_legacy;
  end if;
  if exists (select 1 from public.app_config where key in ('clock_v2', 'scanner_v2') and value = 'false'::jsonb) then
    raise exception 'P5 gate not met: a clock kill switch is off';
  end if;
end $$;

revoke insert, update, delete, truncate on public.time_attendance from authenticated, anon;

drop trigger if exists trg_prevent_duplicate_clock_in on public.time_attendance;

commit;
