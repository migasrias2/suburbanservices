-- The backfill selects `where storage_path is null order by id`, so a handful of
-- rows that always fail (originals larger than the bucket ceiling) sat at the
-- head of the queue and were retried on every pass. Once enough of them
-- accumulated in one batch, `migrated` hit zero, the runner saw no progress and
-- gave up — with healthy rows still waiting behind them.
--
-- Track attempts so a row that cannot be moved is parked instead of blocking
-- everything behind it, and can be reported on at the end.

alter table public.uk_cleaner_task_photos
  add column if not exists migration_attempts integer not null default 0,
  add column if not exists migration_error text;

comment on column public.uk_cleaner_task_photos.migration_attempts is
  'Failed base64 -> Storage migration attempts. 3 or more means parked; see migration_error.';

-- Replaces the old pending index: the migrator now also filters on attempts.
drop index if exists uk_cleaner_task_photos_pending_migration_idx;
create index if not exists uk_cleaner_task_photos_pending_migration_idx
  on public.uk_cleaner_task_photos (id)
  where storage_path is null and photo_data is not null and migration_attempts < 3;

-- Raise the ceiling well clear of anything a phone camera produces. Combined
-- with attempt tracking this is belt and braces rather than a guess.
update storage.buckets
set file_size_limit = 52428800  -- 50 MB
where id = 'task-photos';

create or replace function public.record_photo_migration_failure(p_id integer, p_error text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.uk_cleaner_task_photos
  set migration_attempts = migration_attempts + 1,
      migration_error = left(p_error, 500)
  where id = p_id;
$$;

revoke all on function public.record_photo_migration_failure(integer, text) from public, anon, authenticated;
