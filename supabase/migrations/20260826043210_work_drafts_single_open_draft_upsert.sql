-- work_drafts had grown to ~92k rows (107 MB) with only 4 genuinely open drafts.
-- saveRemoteDraft did UPDATE ... .select('id') and fell back to INSERT whenever
-- that came back empty. Because the autosave effect fires on every photo,
-- confirmation and task-index change, two effects could race past each other
-- before the first INSERT committed, and both would insert.
--
-- Fix: one open draft per cleaner enforced by a partial unique index, written
-- through a single atomic upsert instead of a read-then-write.

-- collapse any existing duplicates, newest wins
with ranked as (
  select id, row_number() over (partition by cleaner_id order by updated_at desc nulls last, created_at desc) rn
  from public.work_drafts
  where not is_finalized
)
update public.work_drafts w
set is_finalized = true
from ranked r
where w.id = r.id and r.rn > 1;

create unique index if not exists work_drafts_one_open_per_cleaner
  on public.work_drafts (cleaner_id)
  where not is_finalized;

create or replace function public.save_work_draft(
  p_qr_code_id text,
  p_area_type text,
  p_step text,
  p_current_task_index integer,
  p_state jsonb,
  p_cleaner_name text
)
returns uuid
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'save_work_draft requires an authenticated session';
  end if;

  insert into public.work_drafts as w
    (cleaner_id, cleaner_name, qr_code_id, area_type, step, current_task_index, state, is_finalized, updated_at)
  values
    (auth.uid(), p_cleaner_name, p_qr_code_id, p_area_type, p_step, p_current_task_index, p_state, false, now())
  on conflict (cleaner_id) where not is_finalized
  do update set
    cleaner_name       = excluded.cleaner_name,
    qr_code_id         = excluded.qr_code_id,
    area_type          = excluded.area_type,
    step               = excluded.step,
    current_task_index = excluded.current_task_index,
    state              = excluded.state,
    updated_at         = now()
  returning w.id into v_id;

  return v_id;
end;
$$;

grant execute on function public.save_work_draft(text, text, text, integer, jsonb, text) to authenticated;

-- Finalized drafts have no value once the area has been submitted.
create or replace function public.prune_finalized_work_drafts(p_keep_days integer default 7)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_count integer;
begin
  delete from public.work_drafts
  where is_finalized
    and coalesce(updated_at, created_at) < now() - make_interval(days => p_keep_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.prune_finalized_work_drafts(integer) from public, anon, authenticated;
