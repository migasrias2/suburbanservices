-- Staff directories were readable by every authenticated account.
-- `cleaners`, `managers` and `cleaner_shifts` all carried USING (true) SELECT
-- policies, so any cleaner (or anyone who self-registered) could read every
-- colleague's name, mobile number, email and password_hash.
-- Scope reads to self-or-management, and take password_hash out of reach
-- entirely — the app only ever writes the literal 'managed_by_supabase_auth'
-- into it, so nothing legitimate reads it.

-- ---------- cleaners ----------
drop policy if exists "Authenticated can read cleaners" on public.cleaners;

create policy "cleaners_select_self_or_management"
  on public.cleaners
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.has_app_role(array['manager', 'ops_manager', 'admin'])
  );

-- ---------- managers ----------
drop policy if exists "Authenticated can read managers" on public.managers;

create policy "managers_select_self_or_management"
  on public.managers
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.has_app_role(array['manager', 'ops_manager', 'admin'])
  );

-- ---------- cleaner_shifts ----------
drop policy if exists "cleaner_shifts_select_auth" on public.cleaner_shifts;

create policy "cleaner_shifts_select_own_or_management"
  on public.cleaner_shifts
  for select
  to authenticated
  using (
    cleaner_id = auth.uid()
    or public.has_app_role(array['manager', 'ops_manager', 'admin'])
  );

-- ---------- column-level: hide password_hash ----------
-- A table-level SELECT grant implies every column, so the carve-out has to be
-- revoke-table-then-grant-columns. Any client issuing `select *` against these
-- tables will now error rather than silently succeed — that is intentional and
-- the two call sites have been changed to explicit column lists.
revoke select on public.cleaners from authenticated, anon;
grant select (id, first_name, last_name, mobile_number, email, is_active, created_at, updated_at)
  on public.cleaners to authenticated;

revoke select on public.managers from authenticated, anon;
grant select (id, first_name, last_name, mobile_number, email, employee_id, is_active, created_at, updated_at, username, role)
  on public.managers to authenticated;
