-- Admin-visible staff passwords, per the product decision of 2026-08-26.
--
-- Supabase Auth stores only a bcrypt hash (auth.users.encrypted_password), so
-- a password can never be read back from it -- bcrypt answers "is this guess
-- right?" and nothing else. For an admin to read a cleaner's password off
-- their profile, the plaintext has to be recorded at the moment it is set.
-- That is what this table is for.
--
-- Written only by the service role (the admin-create-user and
-- admin-set-password edge functions). Readable only by an active admin.
--
-- The trade-off, deliberately accepted: anyone holding admin rights, the
-- service-role key, or a raw database connection can read every live staff
-- password here, and staff commonly reuse passwords elsewhere. The blast
-- radius of a leak is correspondingly wider than it was before this table
-- existed.
--
-- Rows exist only for accounts created or reset after this migration. Accounts
-- that predate it have no recorded plaintext and must have their password
-- reset before it can be displayed.

create table if not exists public.user_passwords (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('cleaner', 'manager', 'ops_manager', 'admin')),
  password   text not null,
  updated_at timestamptz not null default now(),
  -- The admin who last set it. Null once that admin's own account is deleted.
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.user_passwords is
  'Plaintext staff passwords for admin display. Service-role writes only, admin-only reads. See migration 20260826150000.';
comment on column public.user_passwords.password is
  'Plaintext. Never expose through a view, RPC, or export that is not admin-gated.';

alter table public.user_passwords enable row level security;

-- Reads: active admins only. has_app_role() resolves the caller from
-- auth.uid() against the admins table, so a forged app_role in JWT
-- user_metadata cannot reach this data.
drop policy if exists user_passwords_admin_select on public.user_passwords;
create policy user_passwords_admin_select
  on public.user_passwords
  for select
  to authenticated
  using (public.has_app_role(array['admin']));

-- No insert/update/delete policy: writes are service-role only, which bypasses
-- RLS. An admin session can read this table but cannot rewrite what it stores,
-- so the recorded plaintext always reflects a real password change made
-- through the edge function.
revoke all on public.user_passwords from anon;
revoke all on public.user_passwords from authenticated;
grant select on public.user_passwords to authenticated;
