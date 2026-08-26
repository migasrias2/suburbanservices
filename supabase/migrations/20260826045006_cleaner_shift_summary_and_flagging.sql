-- Cleaners had no record of their own work and no way to say "those hours are
-- wrong" while they could still remember the shift. Payroll corrections were
-- therefore always initiated by the office, weeks later.

-- Let a cleaner flag their own shift, without letting them write arbitrary
-- columns on the attendance row.
create or replace function public.flag_own_shift(p_attendance_id integer, p_reason text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner uuid;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if v_reason is null then
    raise exception 'a reason is required';
  end if;

  select cleaner_uuid into v_owner from public.time_attendance where id = p_attendance_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'you can only flag your own shifts';
  end if;

  update public.time_attendance
  set needs_review  = true,
      review_reason = concat_ws(' | ', review_reason, 'Cleaner reported: ' || left(v_reason, 500))
  where id = p_attendance_id;

  return true;
end;
$$;

grant execute on function public.flag_own_shift(integer, text) to authenticated;

-- One call for "what did I just do", so the clock-out screen doesn't have to
-- stitch three queries together on a phone with poor signal.
create or replace function public.shift_summary(p_attendance_id integer)
returns table (
  clock_in timestamptz,
  clock_out timestamptz,
  minutes_worked integer,
  site_name text,
  customer_name text,
  areas_completed integer,
  tasks_completed integer,
  photos_taken integer,
  needs_review boolean
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner uuid;
  v_in timestamptz;
  v_out timestamptz;
begin
  select ta.cleaner_uuid, ta.clock_in, ta.clock_out
    into v_owner, v_in, v_out
  from public.time_attendance ta where ta.id = p_attendance_id;

  if v_owner is null then
    raise exception 'shift not found';
  end if;
  if v_owner <> auth.uid() and not public.has_app_role(array['manager','ops_manager','admin']) then
    raise exception 'not your shift';
  end if;

  return query
  select
    v_in,
    v_out,
    greatest(0, (extract(epoch from (coalesce(v_out, now()) - v_in)) / 60)::integer),
    ta.site_name::text,
    ta.customer_name::text,
    (select count(*)::integer from public.uk_cleaner_task_selections s
      where s.cleaner_id = v_owner and s."timestamp" between v_in and coalesce(v_out, now())),
    (select coalesce(sum(jsonb_array_length(
        case when jsonb_typeof(s.completed_tasks::jsonb) = 'array' then s.completed_tasks::jsonb else '[]'::jsonb end
      )), 0)::integer
      from public.uk_cleaner_task_selections s
      where s.cleaner_id = v_owner and s."timestamp" between v_in and coalesce(v_out, now())),
    (select count(*)::integer from public.uk_cleaner_task_photos p
      where p.cleaner_id = v_owner and p.photo_timestamp between v_in and coalesce(v_out, now())),
    ta.needs_review
  from public.time_attendance ta
  where ta.id = p_attendance_id;
end;
$$;

grant execute on function public.shift_summary(integer) to authenticated;
