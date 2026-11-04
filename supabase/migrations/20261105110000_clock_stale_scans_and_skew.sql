-- Clock follow-ups from the P3/P4 client review (14-p3-p4-review.md H2, M6).
-- Applies on top of 20261105090000_server_clock_core.sql. Additive: no table or
-- row changes, only function bodies and the wait parameter's type.
--
-- 1. Stale scans (H2). A scan that sat on a phone for days (shared phone, login
--    expired) used to be clamped onto the person's CURRENT shift: an old
--    clock-out could close today's shift at its clock-in time. Now a clock-in
--    that waited more than 16 h, or a clock-out more than 24 h, is refused with
--    code 'stale_scan' (logged in clock_events, no shift change). Shorter waits
--    keep the existing caps (clock-in 60 min, clock-out 12 h).
-- 2. Phone clock skew (M6). The app sends device.sent_at_ms (phone clock at
--    send time). If it is more than 5 min from the server's clock, flag
--    'phone_clock_skew'; when the recorded time also used a phone-measured wait,
--    the shift is marked needs_review (fixed wording, no client text).
-- 3. p_wait_ms is now numeric in clock_in()/clock_out(), so no value the client
--    sends can fail the call at the type cast (an integer parameter made
--    PostgREST reject anything over 2^31-1 ms with an error). Negative -> 0,
--    huge -> treated as stale, NaN/Infinity -> treated as stale.
--
-- Rollback: re-run sections 8 (review_reasons), 10 (handle_clock_event) and 11
-- (public wrappers, after dropping the numeric versions) of 20261105090000.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- Bound the client's wait to the integer range used internally.
-- ---------------------------------------------------------------------
create or replace function clock_private.bound_wait_ms(p_wait_ms numeric)
returns integer language sql immutable set search_path = '' as $$
  select case
    when p_wait_ms is null or p_wait_ms <= 0 then 0
    -- NaN / Infinity can only come from a broken client: treat as "too old to use".
    when p_wait_ms = 'NaN'::numeric or p_wait_ms = 'Infinity'::numeric then 2147483647
    when p_wait_ms >= 2147483647 then 2147483647
    else round(p_wait_ms)::integer
  end;
$$;

-- Phone clock minus server clock in ms, or null when the app didn't send a
-- plausible sent_at_ms (absent, not a number, outside years 2000-3000).
create or replace function clock_private.phone_clock_skew_ms(p_device jsonb)
returns numeric language plpgsql stable set search_path = '' as $$
declare
  v_sent numeric;
begin
  if p_device is null or jsonb_typeof(p_device) <> 'object'
     or jsonb_typeof(p_device -> 'sent_at_ms') is distinct from 'number' then
    return null;
  end if;
  v_sent := (p_device ->> 'sent_at_ms')::numeric;
  if v_sent not between 946684800000 and 32503680000000 then
    return null;
  end if;
  return v_sent - extract(epoch from now()) * 1000;
end;
$$;

-- ---------------------------------------------------------------------
-- Review notes: add the clock-skew note (fixed wording).
-- ---------------------------------------------------------------------
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
    end,
    case
      when 'phone_clock_skew' = any(p_flags) and coalesce(p_wait_ms, 0) > 0 then
        'The phone''s clock was more than 5 minutes off when this scan was sent, so the time it waited on the phone may be wrong. Check the time.'
    end
  ], null);
$$;

-- ---------------------------------------------------------------------
-- Shared entry point (body of 20261105090000 §10 plus the stale and skew rules).
-- ---------------------------------------------------------------------
create or replace function clock_private.handle_clock_event(
  p_kind text, p_event_id uuid, p_qr_payload text, p_scanned_at timestamptz,
  p_wait_ms integer, p_lat double precision, p_lng double precision, p_device jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_prev   public.clock_events%rowtype;
  v_flags  text[] := '{}';
  v_wait   integer;
  v_stale  boolean;
  v_skew   numeric;
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

  -- More than 30 logged attempts in 10 minutes is a loop, not a person.
  if (select count(*) from public.clock_events
      where user_id = v_uid and received_at > now() - interval '10 minutes') >= 30 then
    return clock_private.result(false, 'rate_limited', 'Too many scans in a short time. Wait a few minutes and try again.');
  end if;

  -- Inputs. Too old to use (H2): clock-in > 16 h, clock-out > 24 h, refused below.
  -- Otherwise the caps stand: clock-in at most 60 min back, clock-out 12 h.
  v_wait := greatest(coalesce(p_wait_ms, 0), 0);
  v_stale := (p_kind = 'clock_in' and v_wait > 57600000) or (p_kind = 'clock_out' and v_wait > 86400000);
  if not v_stale then
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
  end if;
  -- M6: the phone's clock vs ours at send time. Honest phones are within seconds.
  v_skew := clock_private.phone_clock_skew_ms(p_device);
  if abs(v_skew) > 300000 then
    v_flags := array_append(v_flags, 'phone_clock_skew');
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
      elsif v_stale then
        -- Logged below with the QR id, so a manager can see which scan it was.
        v_result := clock_private.result(false, 'stale_scan',
          'This scan was saved on your phone too long ago to use. Tell your manager the real time.',
          null, v_flags, v_qr);
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

-- ---------------------------------------------------------------------
-- Public wrappers: p_wait_ms integer -> numeric (same names, same defaults).
-- PostgREST calls by parameter name, so the app's requests are unchanged.
-- ---------------------------------------------------------------------
drop function if exists public.clock_in(uuid, text, timestamptz, integer, double precision, double precision, jsonb);
drop function if exists public.clock_out(uuid, text, timestamptz, integer, double precision, double precision, jsonb);

create or replace function public.clock_in(
  p_event_id uuid,
  p_qr_payload text,
  p_scanned_at timestamptz default null,
  p_wait_ms numeric default 0,
  p_lat double precision default null,
  p_lng double precision default null,
  p_device jsonb default '{}'::jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select clock_private.handle_clock_event('clock_in', p_event_id, p_qr_payload, p_scanned_at,
    clock_private.bound_wait_ms(p_wait_ms), p_lat, p_lng, p_device);
$$;

create or replace function public.clock_out(
  p_event_id uuid,
  p_qr_payload text,
  p_scanned_at timestamptz default null,
  p_wait_ms numeric default 0,
  p_lat double precision default null,
  p_lng double precision default null,
  p_device jsonb default '{}'::jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select clock_private.handle_clock_event('clock_out', p_event_id, p_qr_payload, p_scanned_at,
    clock_private.bound_wait_ms(p_wait_ms), p_lat, p_lng, p_device);
$$;

revoke all on function public.clock_in(uuid, text, timestamptz, numeric, double precision, double precision, jsonb) from public, anon, service_role;
revoke all on function public.clock_out(uuid, text, timestamptz, numeric, double precision, double precision, jsonb) from public, anon, service_role;
grant execute on function public.clock_in(uuid, text, timestamptz, numeric, double precision, double precision, jsonb) to authenticated;
grant execute on function public.clock_out(uuid, text, timestamptz, numeric, double precision, double precision, jsonb) to authenticated;

-- The wrapper signatures changed: make PostgREST reload its schema cache at commit.
notify pgrst, 'reload schema';

commit;
