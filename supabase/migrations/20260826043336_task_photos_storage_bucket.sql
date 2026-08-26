-- uk_cleaner_task_photos holds 56,890 base64 data URLs in a text column and is
-- 12 GB — 99% of the database. Cleaners upload ~13 MB per shift because images
-- go up at full sensor resolution with a 33% base64 penalty on top.
-- Move the bytes to Storage and keep only a path on the row.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-photos', 'task-photos', false, 5242880, array['image/jpeg','image/webp','image/png'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

alter table public.uk_cleaner_task_photos
  add column if not exists storage_path text;

alter table public.uk_cleaner_task_photos
  alter column photo_data drop not null;

comment on column public.uk_cleaner_task_photos.storage_path is
  'Object path in the task-photos bucket. Rows carry either this or the legacy base64 photo_data, never both.';

create index if not exists uk_cleaner_task_photos_storage_path_idx
  on public.uk_cleaner_task_photos (id)
  where storage_path is not null;

-- Legacy rows still to be moved off base64.
create index if not exists uk_cleaner_task_photos_pending_migration_idx
  on public.uk_cleaner_task_photos (id)
  where storage_path is null and photo_data is not null;

-- ---------- bucket access ----------
-- Path convention: <cleaner_id>/<uuid>.jpg — the first folder segment is the
-- owning cleaner, which is what the policies key off.

drop policy if exists "task_photos_insert_own" on storage.objects;
create policy "task_photos_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "task_photos_select_own_or_management" on storage.objects;
create policy "task_photos_select_own_or_management"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'task-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_app_role(array['manager', 'ops_manager', 'admin'])
    )
  );

drop policy if exists "task_photos_delete_management" on storage.objects;
create policy "task_photos_delete_management"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-photos'
    and public.has_app_role(array['admin'])
  );
