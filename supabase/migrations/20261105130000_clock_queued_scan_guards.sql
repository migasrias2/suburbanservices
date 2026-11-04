-- Queued-scan guards (15-p3-p4-rereview.md N2, N3). On top of 20261105090000
-- and 20261105110000 (both live). Function bodies only: no table or row changes.
--
-- N2. A queued clock-out whose scan time (arrival minus the phone's wait) is more
--     than 2 min before the target shift's clock-in is refused as 'stale_scan'
--     (same message, logged, flag 'scan_before_shift_start', no change). Before,
--     it was clamped to the clock-in and closed today's shift as a zero-length
--     shift. Applies to the open shift and to the late-clock-out (auto-closed)
--     shift alike. Uses the scan time the phone claims BEFORE the 12 h cap, so a
--     capped old scan can't slip past. Up to 2 min early is still clamped.
-- N3. Phone clock skew (> 5 min, from device.sent_at_ms) now adds a review note
--     by DIRECTION, whatever the wait:
--       clock-out with the phone BEHIND -> review (the recorded finish may be later
--         than the real scan: more pay). Phone ahead -> flag only (it can only
--         shorten pay).
--       clock-in with the phone AHEAD -> review (the computed wait, and so the
--         backdated start, may be too long: more pay). Phone behind -> flag only.
--     The flag 'phone_clock_skew' stays, plus 'phone_clock_behind' or
--     'phone_clock_ahead'. The old rule ("note whenever wait > 0") is replaced.
--
-- do_clock_out gains a trailing p_claimed_at parameter (old 9-arg version dropped).
--
-- Rollback: drop clock_private.do_clock_out(…, text[], timestamptz); re-run
-- do_clock_out from 20261105090000, then review_reasons and handle_clock_event
-- from 20261105110000 (in that order: the handler calls the 9-arg version).

begin;

set local lock_timeout = '5s';

-- Review notes (fixed wording only).
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
      when p_kind = 'clock_out' and 'phone_clock_behind' = any(p_flags) then
        'The phone''s clock was more than 5 minutes behind when this clock-out was sent, so the finish time may be later than the real scan. Check the time.'
      when p_kind = 'clock_in' and 'phone_clock_ahead' = any(p_flags) then
        'The phone''s clock was more than 5 minutes ahead when this clock-in was sent, so the start time may be earlier than the real scan. Check the time.'
    end
  ], null);
$$;

-- Clock-out (body of 20261105090000 plus the N2 guard).
-- New trailing parameter p_claimed_at: the scan time the phone claims (arrival
-- minus the UNCAPPED wait). The 12 h cap would otherwise move an old scan later
-- than the shift start and hide it. The old 9-argument version is dropped first.
drop function if exists clock_private.do_clock_out(uuid, jsonb, jsonb, uuid, timestamptz, integer, double precision, double precision, text[]);

create or replace function clock_private.do_clock_out(
  p_uid uuid, p_actor jsonb, p_qr jsonb, p_event_id uuid, p_at timestamptz,
  p_wait_ms integer, p_lat double precision, p_lng double precision, p_flags text[],
  p_claimed_at timestamptz)
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

  -- N2: a queued clock-out scanned (as claimed, before caps) before this shift began belongs to an earlier
  -- shift (e.g. yesterday's scan sent from a shared phone after today's clock-in).
  -- Closing this shift at its clock-in would erase it, so refuse and log instead.
  -- Up to 2 min early is clock noise and is clamped to the clock-in as before.
  if least(p_at, coalesce(p_claimed_at, p_at)) < v_shift.clock_in - interval '2 minutes' then
    return clock_private.result(false, 'stale_scan',
      'This scan was saved on your phone too long ago to use. Tell your manager the real time.',
      null, array_append(v_flags, 'scan_before_shift_start'), p_qr);
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

-- Entry point (body of 20261105110000 plus the N3 direction flags).
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
  v_claimed_at timestamptz;
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
  v_claimed_at := now() - make_interval(secs => v_wait / 1000.0);   -- before any cap (N2)
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
    -- N3: the direction decides whether pay could have gone up (see review_reasons).
    v_flags := array_append(v_flags, case when v_skew < 0 then 'phone_clock_behind' else 'phone_clock_ahead' end);
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
          v_result := clock_private.do_clock_out(v_uid, v_actor, v_qr, p_event_id, v_at, v_wait, v_lat, v_lng, v_flags, v_claimed_at);
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

commit;
