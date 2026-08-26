-- cleaner_name is varchar(100); the RETURNS TABLE column is text, so cast it.
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
  returning ta.id, ta.cleaner_name::text, ta.clock_out, ta.review_reason;
end;
$$;

revoke all on function public.close_runaway_shifts(numeric) from public, anon, authenticated;
