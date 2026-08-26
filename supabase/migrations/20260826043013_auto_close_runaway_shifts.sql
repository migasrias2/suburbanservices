-- 17.8% of shifts in the last 90 days were unusable for payroll: 167 running
-- past 24 hours, 308 past 12, 14 never closed at all. Clock-out is a second
-- physical QR scan at the end of a shift, which is exactly when someone is
-- least likely to comply, so the failure is structural.
--
-- Rather than guess an end time, close the row at the cleaner's last recorded
-- activity (QR scan or task photo) and flag it. Payroll reviews the flag
-- instead of silently paying a 30-hour shift.

alter table public.time_attendance
  add column if not exists auto_closed_at timestamptz,
  add column if not exists needs_review boolean not null default false,
  add column if not exists review_reason text;

comment on column public.time_attendance.needs_review is
  'Shift could not be trusted as-recorded (auto-closed, over-long, or manually flagged). Must be reviewed before payroll.';

create index if not exists time_attendance_needs_review_idx
  on public.time_attendance (needs_review, clock_in desc)
  where needs_review;

-- NOTE: superseded below by the ::text cast on cleaner_name (varchar(100)).
create or replace function public.close_runaway_shifts(p_max_hours numeric default 12)
returns table (closed_id integer, cleaner text, closed_at timestamptz, basis text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return query
  with runaway as (
    select ta.id, ta.cleaner_uuid, ta.cleaner_name, ta.clock_in
    from public.time_attendance ta
    where ta.clock_out is null
      and ta.clock_in < now() - make_interval(hours => p_max_hours::int)
  ),
  -- best available evidence of when work actually stopped
  activity as (
    select
      r.id,
      greatest(
        coalesce((
          select max(cl."timestamp") from public.cleaner_logs cl
          where cl.cleaner_id = r.cleaner_uuid
            and cl."timestamp" between r.clock_in and r.clock_in + make_interval(hours => p_max_hours::int)
        ), r.clock_in),
        coalesce((
          select max(p.photo_timestamp) from public.uk_cleaner_task_photos p
          where p.cleaner_id = r.cleaner_uuid
            and p.photo_timestamp between r.clock_in and r.clock_in + make_interval(hours => p_max_hours::int)
        ), r.clock_in)
      ) as last_seen
    from runaway r
  )
  update public.time_attendance ta
  set clock_out      = a.last_seen,
      auto_closed_at = now(),
      needs_review   = true,
      review_reason  = case
        when a.last_seen > ta.clock_in
          then format('Auto-closed after %s h with no clock-out; end time taken from last recorded activity.', p_max_hours)
        else format('Auto-closed after %s h with no clock-out and no recorded activity; duration set to zero.', p_max_hours)
      end
  from activity a
  where ta.id = a.id
  returning ta.id, ta.cleaner_name, ta.clock_out, ta.review_reason;
end;
$$;

revoke all on function public.close_runaway_shifts(numeric) from public, anon, authenticated;

-- Flag shifts that DID get a clock-out but ran implausibly long, so they are
-- reviewed too rather than paid at face value.
create or replace function public.flag_overlong_shifts(p_max_hours numeric default 12)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_count integer;
begin
  update public.time_attendance
  set needs_review  = true,
      review_reason = coalesce(review_reason, format('Shift recorded as %s hours, over the %s h plausibility cap.',
                        round(extract(epoch from (clock_out - clock_in))/3600.0, 1), p_max_hours))
  where clock_out is not null
    and not needs_review
    and clock_out - clock_in > make_interval(hours => p_max_hours::int);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.flag_overlong_shifts(numeric) from public, anon, authenticated;
