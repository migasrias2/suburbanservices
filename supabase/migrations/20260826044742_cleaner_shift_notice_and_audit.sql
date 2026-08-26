-- The Employment Rights Act 2025 brings reasonable notice of shifts, and
-- compensation for shifts cancelled or cut short at short notice, into force
-- from October 2026, with guaranteed-hours offers following in 2027 based on a
-- rolling reference period of hours actually worked.
--
-- All three need the same thing this table has never recorded: when a shift was
-- published to the worker, and every change made to it afterwards. The audit is
-- written by a trigger rather than the client so it cannot be forgotten.

alter table public.cleaner_shifts
  add column if not exists published_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

comment on column public.cleaner_shifts.published_at is
  'When this shift became visible to the cleaner. NULL means draft — not yet notified, and not shown in their app.';

create index if not exists cleaner_shifts_published_idx
  on public.cleaner_shifts (cleaner_id, start_at)
  where published_at is not null and cancelled_at is null;

-- ---------- audit trail ----------
create table if not exists public.cleaner_shift_changes (
  id            uuid primary key default gen_random_uuid(),
  shift_id      uuid not null,
  cleaner_id    uuid not null,
  change_type   text not null check (change_type in ('created','published','rescheduled','cancelled','deleted','edited')),
  changed_by    uuid,
  changed_at    timestamptz not null default now(),
  -- hours between the change and the shift start: the number that decides
  -- whether notice was reasonable and whether compensation is owed
  notice_hours  numeric,
  previous_start timestamptz,
  previous_end   timestamptz,
  new_start      timestamptz,
  new_end        timestamptz,
  detail        text
);

create index if not exists cleaner_shift_changes_shift_idx on public.cleaner_shift_changes (shift_id, changed_at desc);
create index if not exists cleaner_shift_changes_cleaner_idx on public.cleaner_shift_changes (cleaner_id, changed_at desc);

alter table public.cleaner_shift_changes enable row level security;

create policy "shift_changes_select_own_or_management"
  on public.cleaner_shift_changes for select to authenticated
  using (
    cleaner_id = auth.uid()
    or public.has_app_role(array['manager','ops_manager','admin'])
  );

-- ---------- the trigger ----------
create or replace function public.log_cleaner_shift_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_type text;
  v_ref timestamptz;
  v_detail text;
begin
  if tg_op = 'INSERT' then
    v_type := case when new.published_at is not null then 'published' else 'created' end;
    v_ref := new.start_at;
    v_detail := case when new.published_at is null then 'Draft shift created' else 'Shift created and published' end;

  elsif tg_op = 'DELETE' then
    v_type := 'deleted';
    v_ref := old.start_at;
    v_detail := 'Shift deleted';

  else
    -- pick the most consequential change; ordering matters for the audit story
    if old.cancelled_at is null and new.cancelled_at is not null then
      v_type := 'cancelled';
      v_detail := coalesce(new.cancellation_reason, 'Shift cancelled');
    elsif old.published_at is null and new.published_at is not null then
      v_type := 'published';
      v_detail := 'Shift published to cleaner';
    elsif old.start_at is distinct from new.start_at or old.end_at is distinct from new.end_at then
      v_type := 'rescheduled';
      v_detail := 'Shift times changed';
    else
      v_type := 'edited';
      v_detail := 'Shift details changed';
    end if;
    -- notice is measured against the time the cleaner was originally told
    v_ref := coalesce(old.start_at, new.start_at);
  end if;

  insert into public.cleaner_shift_changes (
    shift_id, cleaner_id, change_type, changed_by, notice_hours,
    previous_start, previous_end, new_start, new_end, detail
  ) values (
    coalesce(new.id, old.id),
    coalesce(new.cleaner_id, old.cleaner_id),
    v_type,
    auth.uid(),
    round(extract(epoch from (v_ref - now())) / 3600.0, 2),
    case when tg_op <> 'INSERT' then old.start_at end,
    case when tg_op <> 'INSERT' then old.end_at end,
    case when tg_op <> 'DELETE' then new.start_at end,
    case when tg_op <> 'DELETE' then new.end_at end,
    v_detail
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_log_cleaner_shift_change on public.cleaner_shifts;
create trigger trg_log_cleaner_shift_change
  after insert or update or delete on public.cleaner_shifts
  for each row execute function public.log_cleaner_shift_change();

-- Existing rows predate the audit; treat them as already published so the two
-- shifts already in the table don't silently vanish from the cleaner's app.
update public.cleaner_shifts set published_at = coalesce(published_at, created_at, now())
where published_at is null;
