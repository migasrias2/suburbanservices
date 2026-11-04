-- FLAREN-109, part 1 of 3. Retire manager_delete_cleaner.
--
-- On 2026-11-01 the Delete button on the client/manager roster called
-- manager_delete_cleaner and removed about 22 cleaner accounts and their data
-- at the South of England Showground; the client restored from backup. The app
-- no longer calls it (the button, its handler and deleteCleaner() are gone),
-- so every overload of it is dropped here, in whatever schema it lives.
--
-- Why DROP rather than REVOKE: `authenticated` is a member of the custom role
-- `admin_executor`. If admin_executor owns the function, or holds EXECUTE on
-- it, a REVOKE from authenticated does not stick -- the grant is inherited. A
-- dropped function cannot be called by anyone. Admins deactivate staff through
-- admin_deactivate_user (a soft delete), which is untouched.
--
-- This RPC was created by hand in the live database and never had a migration,
-- so its signature is not known here. The loop discovers every overload, copies
-- its definition into backup.dropped_routines_20261104 first, then drops it.
-- To restore one: run the `definition` column, then re-apply the `acl` grants.
--
-- Idempotent: a second run finds nothing to drop. Run
-- scripts/2026-11-04-staff-delete-preflight.sql first; its section 2 lists the
-- overloads and whether the role running this migration can drop them.

create schema if not exists backup;

create table if not exists backup.dropped_routines_20261104 (
  signature        text primary key,
  owner            name not null,
  security_definer boolean not null,
  acl              text,
  definition       text not null,
  dropped_at       timestamptz not null default now()
);
alter table backup.dropped_routines_20261104 enable row level security;
revoke all on backup.dropped_routines_20261104 from public;

do $$
declare
  r record;
begin
  for r in
    select
      format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as signature,
      pg_get_userbyid(p.proowner) as owner,
      p.prosecdef,
      p.proacl::text as acl,
      pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'manager_delete_cleaner'
      and p.prokind in ('f', 'p')
      and n.nspname not in ('pg_catalog', 'information_schema')
  loop
    insert into backup.dropped_routines_20261104 (signature, owner, security_definer, acl, definition)
    values (r.signature, r.owner, r.prosecdef, r.acl, r.definition)
    on conflict (signature) do nothing;

    begin
      execute format('drop routine %s', r.signature);
    exception
      when insufficient_privilege then
        raise exception
          'Cannot drop % (owned by %). Run this migration as % or a role that is a member of it.',
          r.signature, r.owner, r.owner;
      when dependent_objects_still_exist then
        raise exception
          'Cannot drop %: other objects depend on it. Nothing was changed; see preflight section 2.',
          r.signature;
    end;

    raise notice 'Dropped %', r.signature;
  end loop;
end
$$;

-- Fail loudly if anything survived (for example, created concurrently).
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'manager_delete_cleaner'
      and n.nspname not in ('pg_catalog', 'information_schema')
  ) then
    raise exception 'manager_delete_cleaner still exists after the drop loop';
  end if;
end
$$;
