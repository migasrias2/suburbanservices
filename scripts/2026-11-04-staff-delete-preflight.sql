-- FLAREN-109 preflight. READ-ONLY. Run in the Supabase SQL editor for the UK
-- project (xzrmsqqcsvnsduzsmyig) BEFORE applying:
--   supabase/migrations/20261104120000_retire_manager_delete_cleaner.sql
--   supabase/migrations/20261104120100_block_non_admin_staff_deletes.sql
--   supabase/migrations/20261104120200_scope_client_manager_reads.sql
--
-- It lists the live state those migrations assume. The whole script runs in a
-- READ ONLY transaction that is rolled back, so it cannot change anything.
-- Each section's header says what to look for. The SQL editor shows only the
-- last result set, so run it one section at a time (or use psql).

begin;
set transaction read only;

-- 1. Who is running this. The migrations must run as a role that can drop the
--    function in section 2 (normally postgres).
select current_user, session_user, version();

-- 2. Every overload of manager_delete_cleaner. Migration 1 drops all of them.
--    Look for: can_current_user_drop = false (migration 1 would abort), and
--    has_dependents = true (it would abort too).
select
  p.oid::regprocedure                                   as signature,
  n.nspname                                             as schema,
  pg_get_userbyid(p.proowner)                           as owner,
  p.prosecdef                                           as security_definer,
  p.proacl                                              as acl,
  pg_has_role(current_user, p.proowner, 'USAGE')        as can_current_user_drop,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can_execute,
  exists (select 1 from pg_depend d where d.refobjid = p.oid and d.deptype = 'n') as has_dependents,
  pg_get_functiondef(p.oid)                             as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'manager_delete_cleaner';

-- 3. Role graph around anon / authenticated / admin_executor. If authenticated
--    is a member of a role that holds DELETE on a staff table, migration 2's
--    REVOKE does not take effect for that table; section 4 shows the result.
select
  r.rolname as granted_role,
  m.rolname as member,
  m.rolinherit as member_inherits,
  am.admin_option
from pg_auth_members am
join pg_roles r on r.oid = am.roleid
join pg_roles m on m.oid = am.member
where r.rolname in ('anon', 'authenticated', 'admin_executor')
   or m.rolname in ('anon', 'authenticated', 'admin_executor')
order by 1, 2;

-- 4. Staff tables: existence, owner, RLS, explicit ACL and EFFECTIVE privileges
--    (inherited ones included). After migration 2, every row should have
--    auth_delete = false, or rls_enabled = true. Rows with rls_enabled = false
--    and an inherited DELETE make migration 2 abort on purpose.
with t(name) as (
  values ('cleaners'), ('managers'), ('admins'), ('time_attendance'), ('cleaner_logs'),
         ('uk_cleaner_task_selections'), ('uk_cleaner_task_photos'), ('manager_cleaners'),
         ('manager_customers'), ('cleaner_customers'), ('live_tracking'), ('work_drafts'),
         ('user_passwords'), ('cleaner_shift_changes'), ('clock_event_failures'),
         ('cleaner_shifts'), ('bathroom_assist_requests')
)
select
  t.name,
  c.relkind,
  pg_get_userbyid(c.relowner)                                   as owner,
  c.relrowsecurity                                              as rls_enabled,
  c.relforcerowsecurity                                         as rls_forced,
  c.relacl                                                      as acl,
  has_table_privilege('authenticated', c.oid, 'SELECT')         as auth_select,
  has_table_privilege('authenticated', c.oid, 'DELETE')         as auth_delete,
  has_table_privilege('authenticated', c.oid, 'TRUNCATE')       as auth_truncate,
  has_table_privilege('anon', c.oid, 'SELECT')                  as anon_select,
  has_table_privilege('anon', c.oid, 'DELETE')                  as anon_delete,
  case when to_regrole('admin_executor') is not null
       then has_table_privilege('admin_executor', c.oid, 'DELETE') end as admin_executor_delete
from t
left join pg_class c
  on c.relname = t.name
 and c.relnamespace = 'public'::regnamespace
order by t.name;

-- 5. Existing policies on those tables. Migrations 2 and 3 only ADD restrictive
--    policies (staff_delete_admin_only, client_manager_reads_own_cleaners,
--    client_manager_reads_own_customers); nothing here is dropped.
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'cleaners', 'managers', 'admins', 'time_attendance', 'cleaner_logs',
    'uk_cleaner_task_selections', 'uk_cleaner_task_photos', 'manager_cleaners',
    'manager_customers', 'cleaner_customers', 'live_tracking', 'work_drafts',
    'user_passwords', 'cleaner_shift_changes', 'clock_event_failures',
    'cleaner_shifts', 'bathroom_assist_requests'
  )
order by tablename, cmd, policyname;

-- 6. Every function whose body deletes from (or truncates) a staff table, or
--    whose name sounds destructive. Look for:
--      * security_definer = false + a staff table: migration 2 keeps that
--        table's DELETE grant (WARNING) so the flow keeps working;
--      * authenticated_can_execute = true on anything that is not admin-gated:
--        these are other ways a client/manager login could delete staff data.
select
  p.oid::regprocedure                                      as signature,
  pg_get_userbyid(p.proowner)                              as owner,
  p.prosecdef                                              as security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can_execute,
  p.prosrc ~* 'auth\.uid\(\)'                              as checks_auth_uid,
  p.prosrc ~* 'has_app_role'                               as checks_has_app_role,
  array(
    select m[1] from regexp_matches(
      p.prosrc,
      '(?:delete\s+from|truncate(?:\s+table)?)\s+(?:only\s+)?(?:"?public"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)',
      'gi'
    ) as m
  )                                                        as deletes_from
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.prosrc ~* '(delete\s+from|truncate)'
    or p.proname ~* '(delete|remove|purge|wipe|destroy|deactivate)'
  )
order by p.prosecdef, 1;

-- 7. Column types migration 3 compares against (cleaner columns and the scope
--    tables). Migration 3 casts as needed, but a non-uuid value in
--    manager_cleaners.cleaner_id would make client-login reads fail loudly.
select c.relname as table_name, a.attname as column_name, format_type(a.atttypid, a.atttypmod) as type
from pg_attribute a
join pg_class c on c.oid = a.attrelid
where c.relnamespace = 'public'::regnamespace
  and not a.attisdropped
  and (c.relname, a.attname) in (
    ('time_attendance', 'cleaner_uuid'), ('cleaner_logs', 'cleaner_id'),
    ('uk_cleaner_task_selections', 'cleaner_id'), ('uk_cleaner_task_photos', 'cleaner_id'),
    ('live_tracking', 'cleaner_id'), ('bathroom_assist_requests', 'customer_name'),
    ('bathroom_assist_requests', 'location_label'), ('manager_cleaners', 'manager_id'),
    ('manager_cleaners', 'cleaner_id'), ('manager_customers', 'manager_id'),
    ('manager_customers', 'customer_id'), ('uk_customers', 'id'), ('uk_customers', 'name'),
    ('uk_customers', 'display_name')
  )
order by 1, 2;

select count(*) as non_uuid_cleaner_links
from public.manager_cleaners
where cleaner_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 8. The role check every policy relies on, and the scope RPC the app now
--    REQUIRES for client logins (if a client login cannot execute it, the app
--    shows "We couldn't confirm which site this login belongs to").
select
  p.oid::regprocedure as signature,
  p.prosecdef         as security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('has_app_role', 'admin_list_manager_customer_scopes');

-- 9. Admin RPCs that take the admin's id as an argument. If the body checks
--    p_admin_id against the admins table instead of auth.uid(), any signed-in
--    user who knows an admin's uuid can call it as that admin.
select
  p.oid::regprocedure as signature,
  p.prosecdef         as security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  p.prosrc ~* 'auth\.uid\(\)'  as checks_auth_uid,
  p.prosrc ~* 'has_app_role'   as checks_has_app_role
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and 'p_admin_id' = any (coalesce(p.proargnames, '{}'))
order by 1;

-- 10. Client logins after this change. would_see_nothing = true means the
--     dashboard shows "This login isn't linked to a site yet" (app change) and,
--     after migration 3, the database returns nothing either. The app also
--     honours two legacy hardcoded scopes (src/lib/managerScope.ts): AvTrade
--     manager df0bf2e7-..., PSM managers ce2c8d1a-... / bffb28ae-... and any
--     manager whose name contains "james". Those count as linked in the app but
--     NOT in migration 3 unless they have manager_customers rows here.
select
  m.id,
  coalesce(nullif(btrim(concat_ws(' ', m.first_name, m.last_name)), ''), m.username) as name,
  m.username,
  m.is_active,
  (select count(*) from public.manager_customers mc where mc.manager_id::text = m.id::text) as customer_links,
  (select count(*) from public.manager_cleaners mcl where mcl.manager_id::text = m.id::text) as cleaner_links,
  m.id::text in ('4d1381ae-332f-4ff4-8ae3-f062dd5b487f', '6d72f75b-9baa-4577-ba92-16c1a5474f44',
                 'bcda2a69-79ee-45e5-8ee6-c2a132beb576') as has_hardcoded_cleaner_fallback,
  m.id::text in ('df0bf2e7-1a07-4876-949c-6cfe8fe0fac6', 'ce2c8d1a-6e0a-4d78-9746-2cd32983455f',
                 'bffb28ae-5ed3-46f2-8ec9-9864fab34301') as has_hardcoded_customer_scope,
  (
    (select count(*) from public.manager_customers mc where mc.manager_id::text = m.id::text) = 0
    or (
      (select count(*) from public.manager_cleaners mcl where mcl.manager_id::text = m.id::text) = 0
      and m.id::text not in ('4d1381ae-332f-4ff4-8ae3-f062dd5b487f', '6d72f75b-9baa-4577-ba92-16c1a5474f44',
                             'bcda2a69-79ee-45e5-8ee6-c2a132beb576')
    )
  ) as would_see_nothing_in_db
from public.managers m
where coalesce(m.role, 'manager') = 'manager'
order by would_see_nothing_in_db desc, name;

-- 11. Attendance rows from the last 90 days with no cleaner_uuid. Migration 3
--     hides these from client logins (they cannot be tied to a linked cleaner).
select count(*) as recent_attendance_rows_without_cleaner_uuid
from public.time_attendance
where cleaner_uuid is null
  and clock_in > now() - interval '90 days';

-- 12. Names migration 1 and 3 would create; should be empty on a first run.
select 'table' as kind, to_regclass('backup.dropped_routines_20261104')::text as existing
union all
select 'function', p.oid::regprocedure::text
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('is_client_manager', 'client_manager_cleaner_ids', 'client_manager_sees_customer');

rollback;
