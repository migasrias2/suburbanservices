-- Ops managers could never clock in. time_attendance.cleaner_uuid pointed at
-- cleaners(id) while the INSERT policy demanded cleaner_uuid = auth.uid(), and
-- an ops manager lives in managers, never cleaners. Their own uuid broke the
-- FK, NULL failed the policy, a cleaner's uuid failed the policy. No legal row
-- existed: 0 of 1547 attendance rows belong to a manager.

-- 1. auth.users covers every staff member. cleaners.id IS the auth uid, so all
--    1229 existing non-null rows stay valid and nothing is rewritten.
alter table public.time_attendance
  drop constraint time_attendance_cleaner_uuid_fkey;

alter table public.time_attendance
  add constraint time_attendance_cleaner_uuid_fkey
  foreign key (cleaner_uuid) references auth.users(id) on delete cascade;

-- 2. An ops site visit is not a cleaning shift. Without a discriminator the
--    two are indistinguishable in analytics, hours worked and "who is on site".
--    Existing rows take the default, which is what they all are.
alter table public.time_attendance
  add column worker_role text not null default 'cleaner';

alter table public.time_attendance
  add constraint time_attendance_worker_role_check
  check (worker_role in ('cleaner', 'ops_manager'));

-- 3. Otherwise a cleaner could stamp their own row 'ops_manager' and disappear
--    from compliance reporting. Writing 'cleaner' stays unconditional, so the
--    existing cleaner clock-in path is untouched by this.
drop policy "Cleaners insert own attendance" on public.time_attendance;

create policy "Staff insert own attendance"
  on public.time_attendance
  for insert to authenticated
  with check (
    cleaner_uuid = auth.uid()
    and (worker_role = 'cleaner' or public.has_app_role(array['ops_manager']))
  );
