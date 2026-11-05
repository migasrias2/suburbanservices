-- flag_own_shift: the cleaner's "these hours look wrong" flag now sticks (F4 / R11 / W8).
--
-- Since 13 Oct the clock-integrity trigger (enforce_attendance_server_time)
-- has reset needs_review and review_reason on any update of a row whose owner
-- is auth.uid(). flag_own_shift is SECURITY DEFINER, but that does not change
-- auth.uid(), so its update was silently undone while the RPC still returned
-- true and the phone showed "flagged". Live data: 1 cleaner flag ever (10 Sep).
--
-- Fix, narrowly (security review 13 §L5, option b: a writer-scoped token):
--   * flag_own_shift takes the private token from P2 (clock_private.rpc_writes)
--     with writer 'flag', runs its one UPDATE, and gives the token back.
--   * The trigger still gives the full bypass only to clock_in()/clock_out().
--     For writer 'flag' it applies every normal freeze, then lets exactly two
--     things through on the caller's own row: needs_review may go false -> true
--     (never back), and review_reason may only grow (the old text stays as
--     its prefix). Times, sources, corrections and event ids stay frozen.
--   * Clients still can't take the token: clock_private has no grants, and the
--     new helpers are revoked like the others.
--   * Token bookkeeping (review of P6): begin_rpc_write stays first-writer-wins
--     (on conflict do nothing); flag_own_shift refuses to run if another writer
--     already holds the token, and gives back only its own token
--     (end_rpc_write('flag')). clock_in()/clock_out() keep the no-argument
--     end_rpc_write(): theirs is the only token in their transaction.
--     rpc_write_active() is dropped: only the old trigger body used it.
--   * A cleaner's notes are capped: flag_own_shift refuses once review_reason
--     would pass 4000 characters (each note is already cut at 500).
--
-- The trigger body below is the live 20261105090000 definition (checked equal,
-- md5 of prosrc 35de48c8…) with only the writer lines added.
--
-- Rollback, in this order: re-create clock_private.rpc_write_active() from
-- section 1 of 20261105090000_server_clock_core.sql, re-run its section 3 (the
-- trigger function), re-run flag_own_shift from
-- 20260826045006_cleaner_shift_summary_and_flagging.sql, then
-- `drop function clock_private.rpc_writer(); drop function clock_private.end_rpc_write(text);`.

begin;

set local lock_timeout = '5s';

-- Which writer holds the token in this transaction; null when none.
create or replace function clock_private.rpc_writer()
returns text language sql stable set search_path = '' as $$
  select writer from clock_private.rpc_writes
  where xact_id = pg_current_xact_id_if_assigned();
$$;
revoke all on function clock_private.rpc_writer() from public, anon, authenticated;

-- Give back the token only if this writer took it (begin_rpc_write is
-- first-writer-wins, so a second writer in the same transaction holds nothing).
create or replace function clock_private.end_rpc_write(p_writer text)
returns void language sql set search_path = '' as $$
  delete from clock_private.rpc_writes
  where xact_id = pg_current_xact_id() and writer = p_writer;
$$;
revoke all on function clock_private.end_rpc_write(text) from public, anon, authenticated;

comment on function clock_private.begin_rpc_write(text) is
  'Takes the trigger token for this transaction. First writer wins: a second call in the same transaction keeps the first writer. Callers that must not run under another writer check clock_private.rpc_writer() afterwards.';

create or replace function public.enforce_attendance_server_time()
returns trigger
language plpgsql
security definer
set search_path = ''          -- L1: authenticated holds CREATE on public; every name below is qualified
as $$
declare
  v_writer        text := clock_private.rpc_writer();
  v_flag_review   boolean;
  v_flag_reason   text;
begin
  if public.is_clock_area_name(new.site_name) then
    new.site_name := new.customer_name;
  end if;

  -- clock_in()/clock_out() decide the times themselves (queued scans, late
  -- clock-outs after the sweep). Only they can write the token row.
  -- flag_own_shift's 'flag' token is not a bypass: see the own-row rules below.
  if v_writer is not null and v_writer <> 'flag' then
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
    -- What flag_own_shift asked for, before the freeze below resets it.
    v_flag_review := new.needs_review;
    v_flag_reason := new.review_reason;

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

    -- flag_own_shift (F4): the owner may raise the flag and add to the reason.
    -- Raise only, never clear; append only, never rewrite what is there.
    if v_writer = 'flag' then
      new.needs_review := old.needs_review or coalesce(v_flag_review, false);
      if v_flag_reason is not null
         and (old.review_reason is null or starts_with(v_flag_reason, old.review_reason)) then
        new.review_reason := v_flag_reason;
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- Same checks and messages as 20260826045006, plus the 4000-character cap, the
-- 'flag' token around the UPDATE, and search_path '' (every name is qualified).
-- If anything raises, the token row rolls back with the transaction; on success
-- it is removed before returning.
create or replace function public.flag_own_shift(p_attendance_id integer, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_new_reason text;
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

  select concat_ws(' | ', review_reason, 'Cleaner reported: ' || left(v_reason, 500)) into v_new_reason
  from public.time_attendance where id = p_attendance_id;
  if length(v_new_reason) > 4000 then
    raise exception 'this shift already has too many notes; please tell your manager instead';
  end if;

  perform clock_private.begin_rpc_write('flag');
  -- First writer wins: never run (or give back) another writer's token.
  if clock_private.rpc_writer() is distinct from 'flag' then
    raise exception 'flag_own_shift: another clock write is in progress';
  end if;
  update public.time_attendance
  set needs_review  = true,
      review_reason = v_new_reason
  where id = p_attendance_id;
  perform clock_private.end_rpc_write('flag');

  return true;
end;
$$;

-- Nothing calls this any more: the trigger above uses rpc_writer().
drop function if exists clock_private.rpc_write_active();

revoke all on function public.flag_own_shift(integer, text) from public, anon;
grant execute on function public.flag_own_shift(integer, text) to authenticated;

commit;
