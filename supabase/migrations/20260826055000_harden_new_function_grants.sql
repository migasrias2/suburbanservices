-- Advisor follow-up on the functions added in this batch.
--
-- Postgres grants EXECUTE to PUBLIC by default, so `grant ... to authenticated`
-- left anon able to call these too. Both functions authorise internally, but a
-- SECURITY DEFINER function reachable by anon is a needless piece of attack
-- surface. The trigger function should never be directly callable at all.

revoke all on function public.flag_own_shift(integer, text) from public, anon;
grant execute on function public.flag_own_shift(integer, text) to authenticated;

revoke all on function public.shift_summary(integer) from public, anon;
grant execute on function public.shift_summary(integer) to authenticated;

-- Trigger functions are invoked by the trigger, never by a client.
revoke all on function public.log_cleaner_shift_change() from public, anon, authenticated;

-- Pin the search_path so the threshold cannot be shadowed by a role-local one.
create or replace function public.short_notice_threshold_hours()
returns numeric
language sql
immutable
set search_path to 'public'
as $$ select 48::numeric $$;
