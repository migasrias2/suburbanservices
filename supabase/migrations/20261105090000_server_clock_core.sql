-- P2: server clock core (clock-in/clock-out rebuild, plan 04 §3, decisions 09).
--
-- Clocking in and out becomes one database call each: clock_in() / clock_out().
-- The server works out who you are (auth.uid() + staff tables, never
-- user_metadata), checks the QR payload, decides the time and returns the saved
-- shift or a clear reason. Every attempt is logged in clock_events, and the
-- same event id can be retried safely (the stored answer comes back).
--
-- Additive only. Old app versions keep writing time_attendance directly, and
-- the server-time trigger keeps treating them exactly as before; their rows are
-- now tagged clock_in_source / close_source = 'legacy_client' so we can tell
-- when nobody uses the old path any more (the P5 gate).
--
-- Not here (owner decisions 4 Nov): no history repair, no backfill, payroll
-- untouched, the legacy "Duplicate clock-in" trigger stays (D12), the 12h sweep
-- keeps its 12h rule (D3).
--
-- Security review fixes (13-p2-security-review.md):
--   H1 a queued clock-in may start at most 60 min before it reached the server
--      (clock-out keeps 12h), and a manager's finish-time correction no longer
--      clears the review flag on a shift whose START was sent late.
--   H2 cleaners can no longer create their own cleaners row or change their own
--      id / active status (same fix the managers table got on 4 Nov).
--   M1 the 16h / 24h late-clock-out limits use the arrival time.
--   M3 per-person rate limit; review notes are added once and length-capped.
--   L1 the rewritten trigger uses search_path ''.  L2 no QR-supplied text in
--      review notes.  L3 lock_timeout.  L7 the sweep re-checks clock_out is null.
--
-- Rollback: .context/clock-rebuild/sql/rollback-20261105090000.sql (order matters:
-- the trigger must be restored before clock_private is dropped).

begin;

-- Fail fast instead of queueing every reader behind the ALTER below.
set local lock_timeout = '5s';

-- 0. The one-open-shift index below needs at most one open shift per person.
--    Live check 4 Nov: 0 duplicates. Abort with a clear message if that changed.
do $$
begin
  if exists (
    select 1 from public.time_attendance
    where clock_out is null and cleaner_uuid is not null
    group by cleaner_uuid having count(*) > 1
  ) then
    raise exception 'server_clock_core: someone has more than one open shift; close the extra one before applying';
  end if;
end $$;

-- =====================================================================
-- 1. Private schema: helpers and the trigger-bypass token.
--    Not exposed through PostgREST and no grants to anon/authenticated.
-- =====================================================================
create schema if not exists clock_private;
revoke all on schema clock_private from public, anon, authenticated;
comment on schema clock_private is
  'Internals of clock_in()/clock_out(). Only the postgres-owned functions use it; clients have no access.';

-- A row here, keyed by the current transaction id, tells the server-time
-- trigger "this write comes from clock_in()/clock_out()". Only postgres can
-- write it, so a client can never take that path, whatever settings it sends.
create table if not exists clock_private.rpc_writes (
  xact_id    xid8 primary key,
  writer     text not null,
  created_at timestamptz not null default now()
);
revoke all on clock_private.rpc_writes from public, anon, authenticated;

create or replace function clock_private.begin_rpc_write(p_writer text)
returns void language sql set search_path = '' as $$
  insert into clock_private.rpc_writes (xact_id, writer)
  values (pg_current_xact_id(), p_writer)
  on conflict (xact_id) do nothing;
$$;

create or replace function clock_private.end_rpc_write()
returns void language sql set search_path = '' as $$
  delete from clock_private.rpc_writes where xact_id = pg_current_xact_id();
$$;

create or replace function clock_private.rpc_write_active()
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from clock_private.rpc_writes
    where xact_id = pg_current_xact_id_if_assigned()
  );
$$;

-- =====================================================================
-- 2. time_attendance: new columns and indexes (existing rows untouched).
-- =====================================================================
alter table public.time_attendance
  add column if not exists clock_in_event_id       uuid,
  add column if not exists clock_out_event_id      uuid,
  add column if not exists clock_out_qr            text,
  add column if not exists clock_in_source         text
    constraint time_attendance_clock_in_source_check
    check (clock_in_source in ('scan', 'legacy_client', 'manager', 'repair')),
  add column if not exists close_source            text
    constraint time_attendance_close_source_check
    check (close_source in ('scan', 'late_scan', 'auto', 'manager', 'legacy_client', 'repair')),
  add column if not exists clock_in_delay_ms       integer,
  add column if not exists clock_out_delay_ms      integer,
  add column if not exists auto_clock_out_estimate timestamptz,
  add column if not exists business_day            date;

comment on column public.time_attendance.clock_in_event_id is 'Client event id of the clock_in() call that opened the shift (idempotency).';
comment on column public.time_attendance.clock_out_event_id is 'Client event id of the clock_out() call that closed the shift.';
comment on column public.time_attendance.clock_out_qr is 'QR id scanned to clock out.';
comment on column public.time_attendance.clock_in_source is 'How the shift was opened: scan = clock_in(); legacy_client = direct insert by an old app version.';
comment on column public.time_attendance.close_source is 'How the shift was closed: scan / late_scan = clock_out(); legacy_client = direct update by an old app version.';
comment on column public.time_attendance.clock_in_delay_ms is 'How long the clock-in waited on the phone before reaching the server.';
comment on column public.time_attendance.clock_out_delay_ms is 'How long the clock-out waited on the phone before reaching the server.';
comment on column public.time_attendance.auto_clock_out_estimate is 'The sweep''s placeholder finish time, kept when a late scan replaced it.';
comment on column public.time_attendance.business_day is 'London date of clock_in. Set for new rows only (no backfill).';

-- One open shift per person, race-free. Replaces nothing: the legacy
-- duplicate trigger stays until P5 (D12).
create unique index if not exists time_attendance_one_open_shift
  on public.time_attendance (cleaner_uuid)
  where clock_out is null and cleaner_uuid is not null;
create unique index if not exists time_attendance_clock_in_event_id_key
  on public.time_attendance (clock_in_event_id) where clock_in_event_id is not null;
create unique index if not exists time_attendance_clock_out_event_id_key
  on public.time_attendance (clock_out_event_id) where clock_out_event_id is not null;
create index if not exists time_attendance_cleaner_uuid_clock_in_idx
  on public.time_attendance (cleaner_uuid, clock_in desc);

-- =====================================================================
-- 3. Server-time trigger: same rules for direct writes, plus
--    (a) the clock_in()/clock_out() bypass and (b) legacy tagging.
-- =====================================================================
create or replace function public.enforce_attendance_server_time()
returns trigger
language plpgsql
security definer
set search_path = ''          -- L1: authenticated holds CREATE on public; every name below is qualified
as $$
begin
  if public.is_clock_area_name(new.site_name) then
    new.site_name := new.customer_name;
  end if;

  -- clock_in()/clock_out() decide the times themselves (queued scans, late
  -- clock-outs after the sweep). Only they can write the token row.
  if clock_private.rpc_write_active() then
    return new;
  end if;

  -- auth.uid() is null for the cron sweep and service-role scripts.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.cleaner_uuid = auth.uid() then
      new.clock_in := now();
      new.close_source := null;
      if new.clock_out is not null then
        new.clock_out := now();
        new.close_source := 'legacy_client';
      end if;
      -- A direct insert can only come from an app version older than clock_in().
      new.clock_in_source         := 'legacy_client';
      new.business_day            := (now() at time zone 'Europe/London')::date;
      new.clock_in_event_id       := null;
      new.clock_out_event_id      := null;
      new.clock_in_delay_ms       := null;
      new.clock_out_delay_ms      := null;
      new.auto_clock_out_estimate := null;
    end if;
    return new;
  end if;

  if old.cleaner_uuid = auth.uid() then
    new.clock_in := old.clock_in;
    if old.clock_out is null and new.clock_out is not null then
      new.clock_out    := now();
      new.close_source := 'legacy_client';
    else
      if old.clock_out is not null then
        new.clock_out := old.clock_out;
      end if;
      new.close_source := old.close_source;
    end if;
    -- Review state belongs to managers: a cleaner must not clear their own flag.
    new.clock_out_missing := old.clock_out_missing;
    new.needs_review      := old.needs_review;
    new.review_reason     := old.review_reason;
    new.auto_closed_at    := old.auto_closed_at;
    new.corrected_at      := old.corrected_at;
    new.corrected_by      := old.corrected_by;
    -- Server-written bookkeeping is frozen too.
    new.clock_in_event_id       := old.clock_in_event_id;
    new.clock_out_event_id      := old.clock_out_event_id;
    new.clock_in_source         := old.clock_in_source;
    new.clock_in_delay_ms       := old.clock_in_delay_ms;
    new.clock_out_delay_ms      := old.clock_out_delay_ms;
    new.auto_clock_out_estimate := old.auto_clock_out_estimate;
    new.business_day            := old.business_day;
    new.clock_out_qr            := old.clock_out_qr;
  end if;

  return new;
end;
$$;

-- =====================================================================
-- 3b. Manager finish-time correction and the sweep (existing functions;
--     bodies are the live definitions with one change each).
-- =====================================================================

-- H1: "Correct finish time" can't fix a start time, so it must not clear the
-- review flag of a shift whose clock-in was sent late (clock_in_delay_ms over
-- 2 min, written only by clock_in()). needs_review and review_reason stay; the
-- UI can later show "start time was sent late" from clock_in_delay_ms.
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
      needs_review      = coalesce(v_row.clock_in_delay_ms, 0) > 120000,
      corrected_at      = now(),
      corrected_by      = auth.uid(),
      notes             = concat_ws(' | ', notes,
                            'Finish time set to ' || to_char(p_clock_out at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI')
                            || ' by a manager (was ' || coalesce(to_char(v_row.clock_out at time zone 'Europe/London', 'HH24:MI'), 'none') || ')')
  where id = p_attendance_id;
end;
$$;

-- L7: the UPDATE re-checks clock_out is null, so a scan clock-out that commits
-- while the sweep waits on the row is not overwritten with the estimate.
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
    and ta.clock_out is null
  returning ta.id, ta.cleaner_name::text, ta.clock_out, ta.review_reason;
end;
$$;

-- =====================================================================
-- 3c. H2: cleaners can't make themselves staff or reactivate themselves.
--     clock_in() trusts the cleaners table, so it must be admin-controlled.
--     Accounts are created only by the admin-create-user Edge Function
--     (service role); the app never inserts or updates cleaners directly.
--     Live columns checked 4 Nov: id, first_name, last_name, mobile_number,
--     email, password_hash, is_active, created_at, updated_at.
-- =====================================================================
drop policy if exists "Authenticated can insert cleaners" on public.cleaners;

create or replace function public.cleaners_guard_privileged_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Runs as the caller (not SECURITY DEFINER) so current_user is the API role.
  -- Definer functions (owner postgres) and the service role are not affected.
  if current_user = 'anon'
     or (current_user = 'authenticated' and not public.has_app_role(array['admin'])) then
    if new.id is distinct from old.id or new.is_active is distinct from old.is_active then
      raise exception 'Only an admin can change a cleaner''s id or status'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cleaners_guard_privileged_columns on public.cleaners;
create trigger cleaners_guard_privileged_columns
  before update on public.cleaners
  for each row execute function public.cleaners_guard_privileged_columns();

-- =====================================================================
-- 4. clock_events: every clock_in()/clock_out() attempt, success or not.
-- =====================================================================
create table if not exists public.clock_events (
  event_id       uuid primary key,                -- client event id, same across retries
  user_id        uuid,                            -- auth.uid(); no FK so the log outlives anything
  kind           text not null check (kind in ('clock_in', 'clock_out')),
  ok             boolean not null,
  code           text not null,
  shift_id       integer,                         -- time_attendance.id (no FK, same reason)
  qr_code_id     text check (char_length(qr_code_id) <= 200),
  qr_status      text,                            -- registered / inactive / unregistered
  qr_payload     text check (char_length(qr_payload) <= 2048),
  scanned_at     timestamptz,                     -- the phone's clock: informational only
  received_at    timestamptz not null default now(),
  effective_at   timestamptz,                     -- the time the server recorded
  wait_ms        integer,
  has_location   boolean,
  flags          text[] not null default '{}',
  device         jsonb not null default '{}' check (pg_column_size(device) <= 4096),
  result         jsonb not null,                  -- returned verbatim on replay
  replay_count   integer not null default 0,
  last_replay_at timestamptz
);
create index if not exists clock_events_user_received_idx on public.clock_events (user_id, received_at desc);
create index if not exists clock_events_received_idx on public.clock_events (received_at desc);
create index if not exists clock_events_shift_idx on public.clock_events (shift_id) where shift_id is not null;

alter table public.clock_events enable row level security;
revoke all on public.clock_events from public, anon, authenticated;
grant select on public.clock_events to authenticated;

drop policy if exists "Read own clock events or management reads all" on public.clock_events;
create policy "Read own clock events or management reads all" on public.clock_events
  for select to authenticated
  using (user_id = auth.uid() or public.has_app_role(array['manager', 'ops_manager', 'admin']));
-- No insert/update/delete policy: only clock_in()/clock_out() write here.

-- =====================================================================
-- 5. app_config: remote kill switches (D9: default ON).
-- =====================================================================
create table if not exists public.app_config (
  key        text primary key check (char_length(key) <= 64),
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
revoke all on public.app_config from public, anon, authenticated;
grant select, insert, update, delete on public.app_config to authenticated;

drop policy if exists "Signed-in users read app config" on public.app_config;
create policy "Signed-in users read app config" on public.app_config
  for select to authenticated using (true);
drop policy if exists "Admins insert app config" on public.app_config;
create policy "Admins insert app config" on public.app_config
  for insert to authenticated with check (public.has_app_role(array['admin']));
drop policy if exists "Admins update app config" on public.app_config;
create policy "Admins update app config" on public.app_config
  for update to authenticated
  using (public.has_app_role(array['admin'])) with check (public.has_app_role(array['admin']));
drop policy if exists "Admins delete app config" on public.app_config;
create policy "Admins delete app config" on public.app_config
  for delete to authenticated using (public.has_app_role(array['admin']));

drop trigger if exists app_config_set_updated_at on public.app_config;
create trigger app_config_set_updated_at before update on public.app_config
  for each row execute function public.set_updated_at();

insert into public.app_config (key, value) values
  ('clock_v2', 'true'::jsonb),
  ('scanner_v2', 'true'::jsonb)
on conflict (key) do nothing;

-- =====================================================================
-- 6. QR helpers. They mirror QRService.parseQRCode / fromPlainText /
--    deriveSiteLabel (src/services/qrService.ts) so the server accepts every
--    poster the app accepts today and files shifts under the same names.
-- =====================================================================

-- normalizeLabel(): trimmed, '' for blanks and "unknown site".
create or replace function clock_private.clean_label(p_value text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_value is null or btrim(p_value) = '' or p_value ~* 'unknown site' then ''
    else btrim(p_value)
  end;
$$;

-- prettifySiteLabel(): "PSM Marine Clock-in" -> "PSM Marine".
create or replace function clock_private.prettify_label(p_value text)
returns text language sql immutable set search_path = '' as $$
  with stripped as (
    select btrim(regexp_replace(
             regexp_replace(
               regexp_replace(clock_private.clean_label(p_value), '[_-]+', ' ', 'g'),
               '\y(clock\s?in|clock\s?out|check\s?in|check\s?out|qr|site)\y', '', 'gi'),
             '\s+', ' ', 'g')) as v
  )
  select coalesce((
    select string_agg(
             case when char_length(w) <= 3 then upper(w) else upper(left(w, 1)) || lower(substr(w, 2)) end,
             ' ' order by n)
    from stripped, regexp_split_to_table(stripped.v, ' ') with ordinality as t(w, n)
    where w <> ''
  ), '');
$$;

-- normalizeQrType()
create or replace function clock_private.normalize_qr_kind(p_type text)
returns text language sql immutable set search_path = '' as $$
  select case btrim(regexp_replace(lower(btrim(coalesce(p_type, ''))), '[^a-z0-9]+', '_', 'g'), '_')
    when 'clock_in'  then 'CLOCK_IN'
    when 'clockin'   then 'CLOCK_IN'
    when 'clock_out' then 'CLOCK_OUT'
    when 'clockout'  then 'CLOCK_OUT'
    when 'area'      then 'AREA'
    when 'task'      then 'TASK'
    when 'feedback'  then 'FEEDBACK'
    else null
  end;
$$;

-- parseQRCode(): null when the app would reject the payload outright.
-- Returns {id, kind, format, customer_name, site_name, area_name, site_id}.
create or replace function clock_private.parse_qr(p_raw text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_raw   text := btrim(coalesce(p_raw, ''));
  v_json  jsonb;
  v_id    text;
  v_kind  text;
  v_norm  text;
  v_first text;
begin
  if v_raw = '' then
    return null;
  end if;

  if left(v_raw, 1) = '{' then
    begin
      v_json := v_raw::jsonb;
    exception when others then
      return null;                                    -- broken JSON: the app rejects it too
    end;
    if jsonb_typeof(v_json) <> 'object' then
      return null;
    end if;
    v_id := nullif(v_json ->> 'id', '');
    if v_id is null and jsonb_typeof(v_json -> 'metadata' -> 'qrCodeId') = 'string' then
      v_id := nullif(v_json -> 'metadata' ->> 'qrCodeId', '');
    end if;
    v_kind := coalesce(
      clock_private.normalize_qr_kind(v_json ->> 'type'),
      clock_private.normalize_qr_kind(v_json -> 'metadata' ->> 'action'),
      clock_private.normalize_qr_kind(v_json -> 'metadata' ->> 'qrType'));
    if v_id is null or (v_kind is null and nullif(v_json ->> 'type', '') is null) then
      return null;                                    -- no id or no type at all
    end if;
    return jsonb_build_object(
      'id', v_id,
      'kind', coalesce(v_kind, 'AREA'),               -- unknown type is treated as an area, like the app
      'format', 'json',
      'customer_name', v_json ->> 'customerName',
      'site_name', v_json -> 'metadata' ->> 'siteName',
      'area_name', v_json -> 'metadata' ->> 'areaName',
      'site_id', v_json ->> 'siteId');
  end if;

  -- Plain text (fromPlainText): clock-out is checked first ("Marine" contains "in").
  v_norm := btrim(regexp_replace(regexp_replace(lower(v_raw), '[_-]+', ' ', 'g'), '\s+', ' ', 'g'));
  v_kind := case
    when v_norm ~ '\y(clock\s*out|check\s*out|clockout|checkout)\y' then 'CLOCK_OUT'
    when v_norm ~ '\y(clock\s*in|check\s*in|clockin|checkin)\y' then 'CLOCK_IN'
    when v_norm ~ '\yfeedback\y' then 'FEEDBACK'
    when v_norm ~ '\ytask\y' then 'TASK'
    else 'AREA'
  end;
  v_first := (regexp_split_to_array(v_raw, '[[:space:]]|[:–-]'))[1];
  return jsonb_build_object(
    'id', v_raw,
    'kind', v_kind,
    'format', 'text',
    'customer_name', case when v_first <> '' and char_length(v_first) <= 30 then v_first end,
    'site_name', null,
    'area_name', v_raw,
    'site_id', null);
end;
$$;

-- deriveSiteLabel() / deriveCustomerLabel() / the area label the app logs.
create or replace function clock_private.qr_labels(p_parsed jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_site    text := clock_private.clean_label(p_parsed ->> 'site_name');
  v_area    text := clock_private.clean_label(p_parsed ->> 'area_name');
  v_cust    text := clock_private.clean_label(p_parsed ->> 'customer_name');
  v_site_id text := clock_private.clean_label(p_parsed ->> 'site_id');
  v_from_qr text := coalesce(nullif(v_site, ''), v_area);
  v_label   text;
begin
  -- pickSiteLabel(): first non-blank candidate that isn't just "Clock In"/"Clock Out".
  select c into v_label
  from unnest(array[v_site, v_area, v_cust, v_site_id]) with ordinality as t(c, n)
  where c <> '' and not public.is_clock_area_name(c)
  order by n limit 1;
  v_label := coalesce(v_label, 'Site');
  if v_label = v_from_qr then
    v_label := coalesce(nullif(clock_private.prettify_label(v_label), ''), v_label);
  end if;
  return jsonb_build_object(
    'customer_name', left(coalesce(nullif(v_cust, ''), v_label), 100),
    'site_name', left(v_label, 100),
    'site_area', coalesce(nullif(clock_private.prettify_label(v_area), ''), v_label));
end;
$$;

-- The scanned payload, checked against building_qr_codes.
-- Kind comes from the scanned payload, exactly as the app decides it today
-- (the registry has at least one wrong type: "PSM Marine Clock-out" is stored
-- as CLOCK_IN). Labels come from the registered payload when there is one.
-- D6 lenient: unregistered/inactive posters are accepted; the status is logged.
create or replace function clock_private.resolve_qr(p_raw text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_scan   jsonb := clock_private.parse_qr(p_raw);
  v_reg    record;
  v_regp   jsonb;
  v_status text := 'unregistered';
  v_source jsonb := v_scan;
begin
  if v_scan is null then
    return null;
  end if;

  select q.qr_code_id, q.customer_name, q.building_area, q.qr_code_url, q.is_active
  into v_reg
  from public.building_qr_codes q
  where q.qr_code_id = v_scan ->> 'id'
     or q.qr_code_url = btrim(p_raw)
     or q.qr_code_id = btrim(p_raw)
  order by (q.qr_code_id = v_scan ->> 'id') desc, (q.qr_code_url = btrim(p_raw)) desc
  limit 1;

  if found then
    v_status := case when v_reg.is_active is false then 'inactive' else 'registered' end;
    v_regp := clock_private.parse_qr(v_reg.qr_code_url);
    v_source := coalesce(v_regp, jsonb_build_object(
      'customer_name', v_reg.customer_name, 'area_name', v_reg.building_area));
  end if;

  return jsonb_build_object(
    'id', left(v_scan ->> 'id', 200),
    'kind', v_scan ->> 'kind',
    'format', v_scan ->> 'format',
    'status', v_status,
    'registered_kind', v_regp ->> 'kind',
    'payload', v_scan
  ) || clock_private.qr_labels(v_source);
end;
$$;

-- Same customer? Compared the way normalize_avtrade_customer() files names.
create or replace function clock_private.same_customer(p_a text, p_b text)
returns boolean language sql immutable set search_path = '' as $$
  select lower(btrim(case when lower(coalesce(p_a, '')) like '%avtrade%' then 'Avtrade' else coalesce(p_a, '') end))
       = lower(btrim(case when lower(coalesce(p_b, '')) like '%avtrade%' then 'Avtrade' else coalesce(p_b, '') end));
$$;

-- =====================================================================
-- 7. Identity: table membership only, never user_metadata.
--    Who may clock: active cleaners, and active managers with role
--    ops_manager (site visits). Plain managers and admins have never had a
--    time_attendance row (live check 4 Nov) and worker_role only allows
--    cleaner/ops_manager, so they get role_not_allowed.
-- =====================================================================
create or replace function clock_private.resolve_actor(p_uid uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_c record;
  v_m record;
  v_is_cleaner boolean;
  v_is_manager boolean;
begin
  select c.first_name, c.last_name, c.mobile_number, c.is_active into v_c
  from public.cleaners c where c.id = p_uid;
  v_is_cleaner := found;
  if v_is_cleaner and v_c.is_active is distinct from false then
    return jsonb_build_object('status', 'ok', 'worker_role', 'cleaner',
      'name', btrim(regexp_replace(coalesce(v_c.first_name, '') || ' ' || coalesce(v_c.last_name, ''), '\s+', ' ', 'g')),
      'mobile', coalesce(v_c.mobile_number, ''));
  end if;

  select m.first_name, m.last_name, m.mobile_number, m.is_active, m.role into v_m
  from public.managers m where m.id = p_uid;
  v_is_manager := found;
  if v_is_manager and v_m.role = 'ops_manager' and v_m.is_active is distinct from false then
    return jsonb_build_object('status', 'ok', 'worker_role', 'ops_manager',
      'name', btrim(regexp_replace(coalesce(v_m.first_name, '') || ' ' || coalesce(v_m.last_name, ''), '\s+', ' ', 'g')),
      'mobile', coalesce(v_m.mobile_number, ''));
  end if;

  if v_is_cleaner or (v_is_manager and v_m.role = 'ops_manager') then
    return jsonb_build_object('status', 'inactive');
  end if;
  if v_is_manager or exists (select 1 from public.admins a where a.id = p_uid) then
    return jsonb_build_object('status', 'role_not_allowed');
  end if;
  return jsonb_build_object('status', 'not_staff');
end;
$$;

-- =====================================================================
-- 8. Result shape and logging.
-- =====================================================================
create or replace function clock_private.shift_json(p public.time_attendance)
returns jsonb language sql stable set search_path = '' as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id,
    'worker_role', p.worker_role,
    'customer_name', p.customer_name,
    'site_name', p.site_name,
    'clock_in', p.clock_in,
    'clock_out', p.clock_out,
    'business_day', coalesce(p.business_day, (p.clock_in at time zone 'Europe/London')::date),
    'needs_review', p.needs_review,
    'clock_in_source', p.clock_in_source,
    'close_source', p.close_source,
    'auto_closed', p.auto_closed_at is not null,
    'clock_out_missing', p.clock_out_missing
  ) end;
$$;

create or replace function clock_private.result(
  p_ok boolean, p_code text, p_message text,
  p_shift jsonb default null, p_flags text[] default '{}', p_qr jsonb default null)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'ok', p_ok,
    'code', p_code,
    'message', p_message,
    'shift', p_shift,
    'flags', to_jsonb(coalesce(p_flags, '{}'::text[])),
    'qr', case when p_qr is null then null else jsonb_build_object(
            'id', p_qr ->> 'id', 'kind', p_qr ->> 'kind', 'status', p_qr ->> 'status',
            'customer_name', p_qr ->> 'customer_name', 'site_name', p_qr ->> 'site_name') end,
    'replay', false,
    'server_now', now());
$$;

create or replace function clock_private.london_hhmi(p_ts timestamptz)
returns text language sql stable set search_path = '' as $$
  select to_char(p_ts at time zone 'Europe/London', 'HH24:MI');
$$;

-- Review notes are fixed wording plus numbers/ids only (L2: never text from a QR payload).
create or replace function clock_private.review_reasons(p_flags text[], p_wait_ms integer, p_kind text)
returns text[] language sql immutable set search_path = '' as $$
  select array_remove(array[
    case
      when 'queued_clock_in_capped' = any(p_flags) then
        'Clock-in scan waited more than 60 min on the phone; the start was set 60 min before it reached the server. Check the start time.'
      when 'queued_over_2min' = any(p_flags) then
        format('%s scan waited %s min on the phone before reaching the server; check the time.',
               case when p_kind = 'clock_in' then 'Clock-in' else 'Clock-out' end,
               round(p_wait_ms / 60000.0))
    end
  ], null);
$$;

-- M3: add each note once, and never grow review_reason past 1000 characters
-- (existing text is never cut; a note that doesn't fit is dropped, it is still in clock_events).
create or replace function clock_private.append_reasons(p_existing text, p_new text[])
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(p_existing, '');
  r text;
begin
  foreach r in array coalesce(p_new, '{}'::text[]) loop
    if v is null then
      v := left(r, 1000);
    elsif strpos(v, r) = 0 and char_length(v) + 3 + char_length(r) <= 1000 then
      v := v || ' | ' || r;
    end if;
  end loop;
  return v;
end;
$$;

-- =====================================================================
-- 9. The two actions. Called only from public.clock_in()/clock_out(),
--    which already hold the per-person lock and the bypass token.
-- =====================================================================
create or replace function clock_private.do_clock_in(
  p_uid uuid, p_actor jsonb, p_qr jsonb, p_event_id uuid, p_at timestamptz,
  p_wait_ms integer, p_lat double precision, p_lng double precision, p_flags text[])
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_flags    text[] := p_flags;
  v_at       timestamptz := p_at;
  v_open     public.time_attendance%rowtype;
  v_row      public.time_attendance%rowtype;
  v_prev_end timestamptz;
  v_reasons  text[];
  v_cons     text;
begin
  select * into v_open from public.time_attendance
  where cleaner_uuid = p_uid and clock_out is null
  order by clock_in desc limit 1;
  if found then
    if not clock_private.same_customer(v_open.customer_name, p_qr ->> 'customer_name') then
      v_flags := array_append(v_flags, 'open_shift_other_site');
    end if;
    return clock_private.result(true, 'already_clocked_in',
      format('You are already clocked in at %s since %s.', v_open.site_name, clock_private.london_hhmi(v_open.clock_in)),
      clock_private.shift_json(v_open), v_flags, p_qr);
  end if;

  -- A long-queued scan must not start before the previous shift ended.
  select max(clock_out) into v_prev_end from public.time_attendance
  where cleaner_uuid = p_uid and clock_out <= now();
  if v_prev_end > v_at then
    v_at := v_prev_end;
    v_flags := array_append(v_flags, 'clamped_to_previous_shift');
  end if;

  v_reasons := clock_private.review_reasons(v_flags, p_wait_ms, 'clock_in');

  begin
    insert into public.time_attendance (
      cleaner_id, cleaner_uuid, cleaner_name, cleaner_mobile, worker_role,
      customer_name, site_name, clock_in, clock_in_qr, clock_in_gps_lat, clock_in_gps_lng, notes,
      clock_in_event_id, clock_in_source, clock_in_delay_ms, business_day, needs_review, review_reason)
    values (
      null, p_uid, left(coalesce(nullif(p_actor ->> 'name', ''), 'Unknown Cleaner'), 100),
      p_actor ->> 'mobile', p_actor ->> 'worker_role',
      p_qr ->> 'customer_name', p_qr ->> 'site_name', v_at, p_qr ->> 'id', p_lat, p_lng,
      case when p_lat is null then 'Clock-in via QR (no location)' else 'Clock-in via QR' end,
      p_event_id, 'scan', p_wait_ms, (v_at at time zone 'Europe/London')::date,
      cardinality(v_reasons) > 0, clock_private.append_reasons(null, v_reasons))
    returning * into v_row;
  exception
    when unique_violation then
      -- An old app version opened a shift a moment ago (one-open-shift index).
      get stacked diagnostics v_cons = constraint_name;
      if v_cons <> 'time_attendance_one_open_shift' then
        raise;
      end if;
      select * into v_open from public.time_attendance
      where cleaner_uuid = p_uid and clock_out is null order by clock_in desc limit 1;
      return clock_private.result(true, 'already_clocked_in',
        format('You are already clocked in at %s since %s.', v_open.site_name, clock_private.london_hhmi(v_open.clock_in)),
        clock_private.shift_json(v_open), v_flags, p_qr);
    when raise_exception then
      -- Legacy trigger (kept until P5, D12): same person and customer clocked
      -- in under 5 minutes ago and that shift is already closed.
      if sqlerrm not like 'Duplicate clock-in%' then
        raise;
      end if;
      select * into v_open from public.time_attendance
      where cleaner_uuid = p_uid and clock_in > v_at - interval '5 minutes'
      order by clock_in desc limit 1;
      return clock_private.result(false, 'duplicate_clock_in',
        'You clocked in and out here in the last 5 minutes. Wait a few minutes, then scan the Clock In code again.',
        clock_private.shift_json(v_open), v_flags, p_qr);
  end;

  v_flags := v_flags || clock_private.write_side_effects(p_uid, p_actor, p_qr, p_event_id, 'Clock In', v_at, p_lat, p_lng);
  return clock_private.result(true, 'clocked_in',
    format('Clocked in at %s, %s.', v_row.site_name, clock_private.london_hhmi(v_row.clock_in)),
    clock_private.shift_json(v_row), v_flags, p_qr);
end;
$$;

-- cleaner_logs and live_tracking rows the app used to write itself, so
-- history, the calendar, the live board and the sweep's activity estimate keep
-- working. Both tables reference cleaners(id), so ops managers are skipped
-- (they never had these rows). Best effort: a failure never fails the clock.
create or replace function clock_private.write_side_effects(
  p_uid uuid, p_actor jsonb, p_qr jsonb, p_event_id uuid, p_action text,
  p_at timestamptz, p_lat double precision, p_lng double precision)
returns text[] language plpgsql set search_path = '' as $$
begin
  if p_actor ->> 'worker_role' <> 'cleaner' then
    return '{}';
  end if;
  insert into public.cleaner_logs (
    cleaner_id, cleaner_name, action, latitude, longitude, customer_name, site_area, comments, device_info, "timestamp")
  values (
    p_uid, p_actor ->> 'name', p_action, p_lat, p_lng, p_qr ->> 'customer_name', p_qr ->> 'site_area',
    btrim((p_qr ->> 'site_area') || ' - ' || (p_qr ->> 'customer_name')),
    jsonb_build_object('source', 'clock_rpc', 'event_id', p_event_id, 'qr_code_scanned', p_qr -> 'payload'),
    p_at);
  if p_action = 'Clock Out' then
    update public.live_tracking set is_active = false, updated_at = now()
    where cleaner_id = p_uid and is_active;
  end if;
  insert into public.live_tracking (
    cleaner_id, cleaner_name, event_type, latitude, longitude, customer_name, site_area, is_active)
  values (
    p_uid, p_actor ->> 'name', case when p_action = 'Clock In' then 'clock_in' else 'clock_out' end,
    p_lat, p_lng, p_qr ->> 'customer_name', p_qr ->> 'site_area', p_action = 'Clock In');
  return '{}';
exception when others then
  return array['side_effects_failed'];
end;
$$;

create or replace function clock_private.do_clock_out(
  p_uid uuid, p_actor jsonb, p_qr jsonb, p_event_id uuid, p_at timestamptz,
  p_wait_ms integer, p_lat double precision, p_lng double precision, p_flags text[])
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_flags   text[] := p_flags;
  v_shift   public.time_attendance%rowtype;
  v_row     public.time_attendance%rowtype;
  v_out     timestamptz;
  v_reasons text[];
  v_late    boolean := false;
begin
  select * into v_shift from public.time_attendance
  where cleaner_uuid = p_uid and clock_out is null
  order by clock_in desc limit 1 for update;

  if not found then
    -- No open shift. Look only at the latest one: was it closed by the sweep?
    select * into v_shift from public.time_attendance
    where cleaner_uuid = p_uid and clock_in is not null
    order by clock_in desc limit 1 for update;
    if not found then
      return clock_private.result(false, 'no_open_shift', 'You are not clocked in.', null, v_flags, p_qr);
    end if;
    -- M1: both limits use the arrival time (now()), not the phone-claimed scan time,
    -- so a long p_wait_ms can't stretch the 16h window.
    if v_shift.auto_closed_at is not null and v_shift.clock_in > now() - interval '24 hours'
       and v_shift.close_source is distinct from 'late_scan' then
      if v_shift.corrected_at is not null or not v_shift.clock_out_missing then
        return clock_private.result(false, 'already_corrected',
          'Your last shift was closed automatically and its finish time has already been set by your manager.',
          clock_private.shift_json(v_shift), v_flags, p_qr);
      end if;
      if now() > v_shift.clock_in + interval '16 hours' then
        -- D2 limit. Leave the times alone; tell the manager (once) that a scan arrived.
        update public.time_attendance
        set review_reason = clock_private.append_reasons(review_reason, array[
              'A clock-out scan arrived more than 16 hours after the clock-in; set the finish time.'])
        where id = v_shift.id returning * into v_row;
        return clock_private.result(false, 'too_late',
          'This clock-out is more than 16 hours after you clocked in, so it can''t be saved automatically. Your manager will set the finish time.',
          clock_private.shift_json(v_row), array_append(v_flags, 'late_after_auto_close'), p_qr);
      end if;
      v_late := true;                                    -- D2: record the real scan time, flagged
    elsif v_shift.clock_out >= now() - interval '15 minutes'
          and (v_shift.auto_closed_at is null or v_shift.close_source = 'late_scan') then
      -- A retry with a new event id, or a double tap: not an error.
      return clock_private.result(true, 'already_clocked_out',
        format('You already clocked out at %s.', clock_private.london_hhmi(v_shift.clock_out)),
        clock_private.shift_json(v_shift), v_flags, p_qr);
    else
      return clock_private.result(false, 'no_open_shift', 'You are not clocked in.', null, v_flags, p_qr);
    end if;
  end if;

  v_out := greatest(p_at, v_shift.clock_in);
  if v_out > p_at then
    v_flags := array_append(v_flags, 'clamped_to_clock_in');
  end if;
  v_reasons := clock_private.review_reasons(v_flags, p_wait_ms, 'clock_out');
  if v_late then
    v_flags := array_append(v_flags, 'late_after_auto_close');
    v_reasons := v_reasons || format('Clocked out by scan at %s after the automatic close; confirm the hours.',
                                     clock_private.london_hhmi(v_out));
  end if;
  -- D5: another site's code is accepted and flagged; the shift's site is never rewritten.
  if not clock_private.same_customer(v_shift.customer_name, p_qr ->> 'customer_name') then
    v_flags := array_append(v_flags, 'other_site_qr');
    -- L2: fixed wording + the event id; the QR's own names stay in clock_events.
    v_reasons := v_reasons || format('Clocked out with another site''s code (clock event %s); the shift''s site was kept.',
                                     p_event_id);
  end if;
  if v_out > v_shift.clock_in + interval '16 hours' then
    v_flags := array_append(v_flags, 'over_max_shift');
    v_reasons := v_reasons || 'Shift is longer than 16 hours; check the times.'::text;
  end if;

  update public.time_attendance
  set clock_out               = v_out,
      clock_out_qr            = p_qr ->> 'id',
      clock_out_gps_lat       = p_lat,
      clock_out_gps_lng       = p_lng,
      clock_out_event_id      = p_event_id,
      clock_out_delay_ms      = p_wait_ms,
      close_source            = case when v_late then 'late_scan' else 'scan' end,
      auto_clock_out_estimate = case when v_late then v_shift.clock_out else auto_clock_out_estimate end,
      clock_out_missing       = case when v_late then false else clock_out_missing end,
      notes                   = concat_ws(' | ', notes,
                                  case when v_late then 'Late clock-out via QR' else 'Clock-out via QR' end
                                  || case when p_lat is null then ' (no location)' else '' end),
      needs_review            = needs_review or cardinality(v_reasons) > 0,
      review_reason           = clock_private.append_reasons(review_reason, v_reasons)
  where id = v_shift.id
  returning * into v_row;

  v_flags := v_flags || clock_private.write_side_effects(p_uid, p_actor, p_qr, p_event_id, 'Clock Out', v_out, p_lat, p_lng);
  if v_late then
    return clock_private.result(true, 'late_clock_out',
      'Clock-out saved. Your shift had been closed automatically, so your manager will confirm the hours.',
      clock_private.shift_json(v_row), v_flags, p_qr);
  end if;
  return clock_private.result(true, 'clocked_out',
    format('Clocked out at %s.', clock_private.london_hhmi(v_row.clock_out)),
    clock_private.shift_json(v_row), v_flags, p_qr);
end;
$$;

-- =====================================================================
-- 10. Shared entry point: validation, lock, replay, identity, QR, log.
-- =====================================================================
create or replace function clock_private.handle_clock_event(
  p_kind text, p_event_id uuid, p_qr_payload text, p_scanned_at timestamptz,
  p_wait_ms integer, p_lat double precision, p_lng double precision, p_device jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_prev   public.clock_events%rowtype;
  v_flags  text[] := '{}';
  v_wait   integer;
  v_lat    double precision := p_lat;
  v_lng    double precision := p_lng;
  v_device jsonb := coalesce(p_device, '{}'::jsonb);
  v_at     timestamptz;
  v_actor  jsonb;
  v_qr     jsonb;
  v_result jsonb;
  v_want   text := case when p_kind = 'clock_in' then 'CLOCK_IN' else 'CLOCK_OUT' end;
begin
  -- No identity means no idempotency key owner, so nothing is logged.
  if v_uid is null then
    return clock_private.result(false, 'not_signed_in', 'Please sign in again.');
  end if;
  if p_event_id is null then
    return clock_private.result(false, 'bad_request', 'The app sent an incomplete request.');
  end if;

  -- One clock action per person at a time (also makes the replay check race-free).
  perform pg_advisory_xact_lock(hashtextextended('clock:' || v_uid::text, 0));

  select * into v_prev from public.clock_events where event_id = p_event_id;
  if found then
    if v_prev.user_id = v_uid and v_prev.kind = p_kind then
      update public.clock_events
      set replay_count = replay_count + 1, last_replay_at = now()
      where event_id = p_event_id;
      return v_prev.result || jsonb_build_object('replay', true, 'server_now', now());
    end if;
    return clock_private.result(false, 'duplicate_event',
      'This scan was already used for something else. Please scan again.');
  end if;

  -- M3: more than 30 logged attempts in 10 minutes is a loop, not a person.
  -- Answer without writing anything (no log row, no shift change).
  -- Replays above are still answered: they only bump a counter.
  if (select count(*) from public.clock_events
      where user_id = v_uid and received_at > now() - interval '10 minutes') >= 30 then
    return clock_private.result(false, 'rate_limited', 'Too many scans in a short time. Wait a few minutes and try again.');
  end if;

  -- Inputs. Nothing here blocks a clock: bad extras are dropped and flagged.
  -- D4 as revised after the security review (H1): a clock-in may start at most
  -- 60 min before it reached the server (it raises pay); a clock-out keeps 12h
  -- (backdating a finish only lowers pay).
  v_wait := greatest(coalesce(p_wait_ms, 0), 0);
  if p_kind = 'clock_in' and v_wait > 3600000 then
    v_wait := 3600000;
    v_flags := array_append(v_flags, 'queued_clock_in_capped');
  elsif v_wait > 43200000 then
    v_wait := 43200000;
    v_flags := array_append(v_flags, 'wait_capped');
  end if;
  if v_wait > 120000 then
    v_flags := array_append(v_flags, 'queued_over_2min');
  end if;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180
     or v_lat = 'NaN'::float8 or v_lng = 'NaN'::float8 then
    if v_lat is not null or v_lng is not null then
      v_flags := array_append(v_flags, 'location_invalid');
    end if;
    v_lat := null;
    v_lng := null;
  end if;
  if jsonb_typeof(v_device) <> 'object' or pg_column_size(v_device) > 2048 then
    v_device := jsonb_build_object('dropped', true);
    v_flags := array_append(v_flags, 'device_dropped');
  end if;
  v_at := now() - make_interval(secs => v_wait / 1000.0);             -- never in the future

  if p_qr_payload is null or btrim(p_qr_payload) = '' or char_length(p_qr_payload) > 2048 then
    v_result := clock_private.result(false, 'bad_request', 'That code could not be read. Please scan again.', null, v_flags);
  else
    v_actor := clock_private.resolve_actor(v_uid);
    if v_actor ->> 'status' <> 'ok' then
      v_result := clock_private.result(false, v_actor ->> 'status',
        case v_actor ->> 'status'
          when 'inactive' then 'Your account is not active. Contact your manager.'
          when 'role_not_allowed' then 'Your account doesn''t clock in. Only cleaners and ops managers do.'
          else 'Your login isn''t linked to a staff account. Contact your manager.'
        end, null, v_flags);
    else
      v_qr := clock_private.resolve_qr(p_qr_payload);
      if v_qr is null then
        v_result := clock_private.result(false, 'unknown_qr', 'That isn''t a Suburban Services code.', null, v_flags);
      elsif v_qr ->> 'kind' <> v_want then
        v_result := clock_private.result(false, 'wrong_qr_type',
          case v_qr ->> 'kind'
            when 'CLOCK_IN' then 'That is the Clock In code. Scan the Clock Out code to clock out.'
            when 'CLOCK_OUT' then 'That is the Clock Out code. Scan the Clock In code to clock in.'
            else format('That is an area code, not the %s code.', case when p_kind = 'clock_in' then 'Clock In' else 'Clock Out' end)
          end, null, v_flags, v_qr);
      else
        if v_qr ->> 'status' <> 'registered' then
          v_flags := v_flags || ('qr_' || (v_qr ->> 'status'));      -- D6: accepted, logged
        end if;
        if v_qr ->> 'registered_kind' is distinct from v_qr ->> 'kind' and v_qr ->> 'status' <> 'unregistered' then
          v_flags := array_append(v_flags, 'qr_registry_kind_mismatch');
        end if;
        perform clock_private.begin_rpc_write(p_kind);
        if p_kind = 'clock_in' then
          v_result := clock_private.do_clock_in(v_uid, v_actor, v_qr, p_event_id, v_at, v_wait, v_lat, v_lng, v_flags);
        else
          v_result := clock_private.do_clock_out(v_uid, v_actor, v_qr, p_event_id, v_at, v_wait, v_lat, v_lng, v_flags);
        end if;
        perform clock_private.end_rpc_write();
      end if;
    end if;
  end if;

  insert into public.clock_events (
    event_id, user_id, kind, ok, code, shift_id, qr_code_id, qr_status, qr_payload,
    scanned_at, effective_at, wait_ms, has_location, flags, device, result)
  values (
    p_event_id, v_uid, p_kind, (v_result ->> 'ok')::boolean, v_result ->> 'code',
    (v_result -> 'shift' ->> 'id')::integer, left(v_qr ->> 'id', 200), v_qr ->> 'status',
    left(p_qr_payload, 2048), p_scanned_at,
    case when v_result ->> 'code' in ('clocked_in', 'clocked_out', 'late_clock_out') then
      (v_result -> 'shift' ->> case when p_kind = 'clock_in' then 'clock_in' else 'clock_out' end)::timestamptz
    end,
    v_wait, v_lat is not null, coalesce(array(select jsonb_array_elements_text(v_result -> 'flags')), '{}'),
    v_device, v_result)
  on conflict (event_id) do nothing;

  return v_result;
end;
$$;

revoke all on all functions in schema clock_private from public, anon, authenticated;

-- =====================================================================
-- 11. Public API (PostgREST /rpc). Result: {ok, code, message, shift,
--     flags, qr, replay, server_now}. Business outcomes never raise.
-- =====================================================================
create or replace function public.clock_in(
  p_event_id uuid,
  p_qr_payload text,
  p_scanned_at timestamptz default null,
  p_wait_ms integer default 0,
  p_lat double precision default null,
  p_lng double precision default null,
  p_device jsonb default '{}'::jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select clock_private.handle_clock_event('clock_in', p_event_id, p_qr_payload, p_scanned_at, p_wait_ms, p_lat, p_lng, p_device);
$$;

create or replace function public.clock_out(
  p_event_id uuid,
  p_qr_payload text,
  p_scanned_at timestamptz default null,
  p_wait_ms integer default 0,
  p_lat double precision default null,
  p_lng double precision default null,
  p_device jsonb default '{}'::jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select clock_private.handle_clock_event('clock_out', p_event_id, p_qr_payload, p_scanned_at, p_wait_ms, p_lat, p_lng, p_device);
$$;

-- "Am I clocked in?" One answer for the whole app: the open shift (no day
-- window, so night shifts work) or null, plus the last shift closed in 12h.
create or replace function public.current_shift()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_open public.time_attendance%rowtype;
  v_last public.time_attendance%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'not_signed_in', 'open_shift', null, 'last_closed', null,
                              'server_now', now());
  end if;
  select * into v_open from public.time_attendance
  where cleaner_uuid = v_uid and clock_out is null order by clock_in desc limit 1;
  select * into v_last from public.time_attendance
  where cleaner_uuid = v_uid and clock_out is not null and clock_out > now() - interval '12 hours'
  order by clock_out desc limit 1;
  return jsonb_build_object(
    'ok', true,
    'code', case when v_open.id is null then 'not_clocked_in' else 'clocked_in' end,
    'open_shift', clock_private.shift_json(v_open),
    'last_closed', clock_private.shift_json(v_last),
    'server_now', now(),
    'london_today', (now() at time zone 'Europe/London')::date);
end;
$$;

revoke all on function public.clock_in(uuid, text, timestamptz, integer, double precision, double precision, jsonb) from public, anon, service_role;
revoke all on function public.clock_out(uuid, text, timestamptz, integer, double precision, double precision, jsonb) from public, anon, service_role;
revoke all on function public.current_shift() from public, anon, service_role;
grant execute on function public.clock_in(uuid, text, timestamptz, integer, double precision, double precision, jsonb) to authenticated;
grant execute on function public.clock_out(uuid, text, timestamptz, integer, double precision, double precision, jsonb) to authenticated;
grant execute on function public.current_shift() to authenticated;

commit;
