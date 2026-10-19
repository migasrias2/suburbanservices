-- Clock-in/out integrity (2026-10-13 audit).
--
-- 1. Times come from the server, not the phone. A cleaner's insert gets
--    clock_in = now(); closing your own shift gets clock_out = now(); nobody,
--    whatever their role, can rewrite the times or review flags of their own
--    shift. Managers and admins correct other people's shifts; the cron sweep
--    and service-role scripts are unrestricted.
-- 2. A QR area called "Clock In"/"Clock Out" is never a site name. At sites
--    whose codes are named that way, every shift was saved with site
--    "Clock In"/"Clock Out" instead of the real site.
-- 3. A shift the sweep has to close is marked clock_out_missing instead of
--    quietly counting as 0 hours, and managers can set the real finish time
--    through set_shift_clock_out().
-- 4. Failed clock attempts are recorded in clock_event_failures, so the next
--    "it didn't work" can be answered from data instead of guessed at.

-- Snapshot every row this migration rewrites.
create schema if not exists backup;
create table if not exists backup.time_attendance_20261013 as
  select * from public.time_attendance
  where auto_closed_at is not null
     or site_name ~* '^\s*(clock|check)[\s_-]*(in|out)\s*$';
alter table backup.time_attendance_20261013 enable row level security;

alter table public.time_attendance
  add column if not exists clock_out_missing boolean not null default false,
  add column if not exists corrected_at timestamptz,
  add column if not exists corrected_by uuid;

comment on column public.time_attendance.clock_out_missing is
  'True when the cleaner never clocked out and the sweep closed the shift; clock_out is a placeholder until a manager sets the real finish time.';

create or replace function public.is_clock_area_name(p_name text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_name ~* '^\s*(clock|check)[\s_-]*(in|out)\s*$', false);
$$;

create or replace function public.enforce_attendance_server_time()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.is_clock_area_name(new.site_name) then
    new.site_name := new.customer_name;
  end if;

  -- auth.uid() is null for the cron sweep and service-role scripts.
  if auth.uid() is null then
    return new;
  end if;

  -- One rule for everyone, whatever their role: on your own shift the server's
  -- clock is final. Managers and admins correct other people's shifts only.
  if tg_op = 'INSERT' then
    if new.cleaner_uuid = auth.uid() then
      new.clock_in := now();
      if new.clock_out is not null then
        new.clock_out := now();
      end if;
    end if;
    return new;
  end if;

  if old.cleaner_uuid = auth.uid() then
    new.clock_in := old.clock_in;
    if old.clock_out is null and new.clock_out is not null then
      new.clock_out := now();
    elsif old.clock_out is not null then
      new.clock_out := old.clock_out;
    end if;
    -- Review state belongs to managers: a cleaner must not clear their own flag.
    new.clock_out_missing := old.clock_out_missing;
    new.needs_review      := old.needs_review;
    new.review_reason     := old.review_reason;
    new.auto_closed_at    := old.auto_closed_at;
    new.corrected_at      := old.corrected_at;
    new.corrected_by      := old.corrected_by;
  end if;

  return new;
end;
$$;

-- Named to sort first: triggers fire alphabetically, and the duplicate
-- clock-in check must compare server times.
drop trigger if exists aa_enforce_attendance_server_time on public.time_attendance;
create trigger aa_enforce_attendance_server_time
  before insert or update on public.time_attendance
  for each row execute function public.enforce_attendance_server_time();

create or replace function public.close_runaway_shifts(p_max_hours numeric default 12)
returns table(closed_id integer, cleaner text, closed_at timestamp with time zone, basis text)
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
  set clock_out         = a.last_seen,
      auto_closed_at    = now(),
      clock_out_missing = true,
      needs_review      = true,
      review_reason     = case
        when a.last_seen > ta.clock_in + interval '5 minutes'
          then 'No clock-out. Last activity was ' || to_char(a.last_seen at time zone 'Europe/London', 'HH24:MI')
               || '; set the real finish time.'
        else 'No clock-out and no activity after clocking in; set the real finish time.'
      end
  from activity a
  where ta.id = a.id
  returning ta.id, ta.cleaner_name::text, ta.clock_out, ta.review_reason;
end;
$$;

create or replace function public.set_shift_clock_out(p_attendance_id integer, p_clock_out timestamptz)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.time_attendance%rowtype;
begin
  if not public.has_app_role(array['manager', 'ops_manager', 'admin']) then
    raise exception 'Only managers and admins can correct a shift' using errcode = '42501';
  end if;

  select * into v_row from public.time_attendance where id = p_attendance_id for update;
  if not found then
    raise exception 'Shift % not found', p_attendance_id using errcode = 'P0002';
  end if;
  if v_row.cleaner_uuid = auth.uid() then
    raise exception 'Ask another manager to correct your own shift' using errcode = '42501';
  end if;
  if p_clock_out <= v_row.clock_in then
    raise exception 'Finish time must be after the clock-in' using errcode = '22023';
  end if;
  if p_clock_out > v_row.clock_in + interval '16 hours' then
    raise exception 'Finish time is more than 16 hours after the clock-in' using errcode = '22023';
  end if;
  if p_clock_out > now() then
    raise exception 'Finish time cannot be in the future' using errcode = '22023';
  end if;

  update public.time_attendance
  set clock_out         = p_clock_out,
      clock_out_missing = false,
      needs_review      = false,
      corrected_at      = now(),
      corrected_by      = auth.uid(),
      notes             = concat_ws(' | ', notes,
                            'Finish time set to ' || to_char(p_clock_out at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI')
                            || ' by a manager (was ' || coalesce(to_char(v_row.clock_out at time zone 'Europe/London', 'HH24:MI'), 'none') || ')')
  where id = p_attendance_id;
end;
$$;

revoke all on function public.set_shift_clock_out(integer, timestamptz) from public, anon;
grant execute on function public.set_shift_clock_out(integer, timestamptz) to authenticated;

create table if not exists public.clock_event_failures (
  id bigint generated always as identity primary key,
  cleaner_uuid uuid not null default auth.uid(),
  cleaner_name text check (char_length(cleaner_name) <= 200),
  event_type text not null check (event_type in ('clock_in', 'clock_out')),
  reason text not null check (char_length(reason) <= 500),
  qr_code_id text check (char_length(qr_code_id) <= 200),
  customer_name text check (char_length(customer_name) <= 200),
  has_location boolean,
  created_at timestamptz not null default now()
);

create index if not exists clock_event_failures_created_at_idx
  on public.clock_event_failures (created_at desc);

alter table public.clock_event_failures enable row level security;
revoke all on public.clock_event_failures from anon;
grant select, insert on public.clock_event_failures to authenticated;

drop policy if exists "Staff record own clock failures" on public.clock_event_failures;
create policy "Staff record own clock failures" on public.clock_event_failures
  for insert to authenticated
  with check (cleaner_uuid = auth.uid());

drop policy if exists "Managers read clock failures" on public.clock_event_failures;
create policy "Managers read clock failures" on public.clock_event_failures
  for select to authenticated
  using (public.has_app_role(array['manager', 'ops_manager', 'admin']));

-- Backfill: real site names, and sweep-closed shifts nobody has resolved yet.
update public.time_attendance
set site_name = customer_name
where public.is_clock_area_name(site_name);

update public.time_attendance
set clock_out_missing = true
where auto_closed_at is not null and corrected_at is null and needs_review;
