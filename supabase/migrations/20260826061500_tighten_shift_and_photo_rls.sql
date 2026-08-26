-- Two findings from integration-testing with a real cleaner JWT.

-- 1. A draft shift was visible to its own cleaner at the raw table level.
--    Only the publishedOnly filter in shiftsService was hiding it, so any
--    future query that forgets that flag would notify someone of a shift
--    nobody meant to give them. Make the database the guard instead.
drop policy if exists "cleaner_shifts_select_own_or_management" on public.cleaner_shifts;

create policy "cleaner_shifts_select_own_published_or_management"
  on public.cleaner_shifts
  for select
  to authenticated
  using (
    (
      cleaner_id = (select auth.uid())
      and published_at is not null
      and cancelled_at is null
    )
    or public.has_app_role(array['manager', 'ops_manager', 'admin'])
  );

-- 2. Rewrite the photo policy with auth.uid() in a scalar subquery so it is
--    evaluated once per query rather than per row.
drop policy if exists "Cleaners manage own task photos" on public.uk_cleaner_task_photos;

create policy "task_photos_own_or_management"
  on public.uk_cleaner_task_photos
  for all
  to authenticated
  using (
    cleaner_id = (select auth.uid())
    or public.has_app_role(array['manager', 'ops_manager', 'admin'])
  )
  with check (
    cleaner_id = (select auth.uid())
    or public.has_app_role(array['manager', 'ops_manager', 'admin'])
  );

-- Measured 2026-08-26: an unfiltered cleaner read of this table sequential-scans
-- 12 GB and hits the statement timeout, because `cleaner_id = auth.uid() OR
-- has_app_role(...)` cannot use idx_uk_cleaner_task_photos_cleaner_id — if the
-- role check is true, every row qualifies.
--
-- The same query WITH an explicit `where cleaner_id = <uuid>` plans as an index
-- scan and returns in 0.7 ms. Every caller in the app already filters, and
-- shift_summary is SECURITY DEFINER so it bypasses this path entirely.
comment on policy "task_photos_own_or_management" on public.uk_cleaner_task_photos is
  'Own rows or management. Callers MUST filter (cleaner_id / qr_code_id / photo_timestamp) — an unfiltered read seq-scans the whole table and times out.';
