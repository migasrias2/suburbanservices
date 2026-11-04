-- FLAREN-109 preflight. READ-ONLY. Run in the Supabase SQL editor for the UK
-- project (xzrmsqqcsvnsduzsmyig) BEFORE applying:
--   supabase/migrations/20261104120000_retire_manager_delete_cleaner.sql
--   supabase/migrations/20261104120100_block_non_admin_staff_deletes.sql
--   supabase/migrations/20261104120200_scope_client_manager_reads.sql
--   supabase/migrations/20261104120300_scope_client_manager_cleaner_directory.sql
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

-- 2b. Anything else that calls manager_delete_cleaner. Migration 1 drops the
--     function; these would start failing at run time (plpgsql bodies are not
--     tracked as dependencies). Expect no rows.
select
  p.oid::regprocedure          as signature,
  pg_get_userbyid(p.proowner)  as owner,
  p.prosecdef                  as security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosrc ilike '%manager_delete_cleaner%'
  and p.proname <> 'manager_delete_cleaner'
  and n.nspname not in ('pg_catalog', 'information_schema');

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
--      * security_definer = false + a staff table: migration 2 ABORTS and names
--        it. Decide per function: make it SECURITY DEFINER, or take the table
--        out of migration 2's list;
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

-- 7. Columns migrations 3 and 4 place rows at a site with. Missing ones are
--    skipped (with a WARNING). device_info must be json/jsonb for cleaner_logs
--    to be scoped by scanned QR; building_qr_codes.customer_id is used if present.
select c.relname as table_name, a.attname as column_name, format_type(a.atttypid, a.atttypmod) as type
from pg_attribute a
join pg_class c on c.oid = a.attrelid
where c.relnamespace = 'public'::regnamespace
  and not a.attisdropped
  and (c.relname, a.attname) in (
    ('uk_cleaner_task_selections', 'qr_code_id'), ('uk_cleaner_task_selections', 'cleaner_id'),
    ('uk_cleaner_task_photos', 'qr_code_id'), ('uk_cleaner_task_photos', 'storage_path'),
    ('cleaner_logs', 'qr_code_id'), ('cleaner_logs', 'device_info'),
    ('time_attendance', 'customer_name'), ('time_attendance', 'site_name'), ('time_attendance', 'cleaner_uuid'),
    ('bathroom_assist_requests', 'customer_name'), ('bathroom_assist_requests', 'location_label'),
    ('live_tracking', 'customer_name'), ('live_tracking', 'site_area'), ('live_tracking', 'site_id'),
    ('building_qr_codes', 'qr_code_id'), ('building_qr_codes', 'customer_name'), ('building_qr_codes', 'customer_id'),
    ('manager_customers', 'manager_id'), ('manager_customers', 'customer_id'),
    ('cleaner_customers', 'cleaner_id'), ('cleaner_customers', 'customer_id'),
    ('uk_customers', 'id'), ('uk_customers', 'name'), ('uk_customers', 'display_name'),
    ('cleaners', 'id'), ('managers', 'username')
  )
order by 1, 2;

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

-- 10. Client logins after this change. In the app a client login sees the
--     "This login isn't linked to a site yet" screen only with no client scope
--     at all: no manager_customers rows AND no legacy hardcoded entry
--     (src/lib/managerScope.ts: AvTrade df0bf2e7-..., PSM ce2c8d1a-... /
--     bffb28ae-..., or a name containing "james"). Migration 3 only knows
--     manager_customers, so:
--       * db_reads_nothing = true: after migration 3 the database returns no
--         site data to this login;
--       * migration 3 ABORTS if a legacy hardcoded login has customer_links = 0.
select
  m.id,
  coalesce(nullif(btrim(concat_ws(' ', m.first_name, m.last_name)), ''), m.username) as name,
  m.username,
  m.is_active,
  (select count(*) from public.manager_customers mc where mc.manager_id::text = m.id::text) as customer_links,
  (select count(*) from public.manager_cleaners mcl where mcl.manager_id::text = m.id::text) as cleaner_links,
  m.id::text in ('df0bf2e7-1a07-4876-949c-6cfe8fe0fac6', 'ce2c8d1a-6e0a-4d78-9746-2cd32983455f',
                 'bffb28ae-5ed3-46f2-8ec9-9864fab34301') as has_hardcoded_customer_scope,
  not exists (select 1 from public.manager_customers mc where mc.manager_id::text = m.id::text) as db_reads_nothing
from public.managers m
where coalesce(m.role, 'manager') = 'manager'
order by db_reads_nothing desc, name;

-- 10b. What each client login matches after migration 3: its client labels,
--      the QR codes it gets by customer_id (if that column exists) and by
--      whole-word name, and how many recent attendance rows its names match.
--      qr_by_name = 0 and qr_by_customer_id = 0 means its task rows, photos and
--      QR-placed scan logs disappear for it.
select
  m.username,
  array_agg(distinct lower(btrim(label.value))) as labels,
  (select count(*) from public.building_qr_codes q
   where (to_jsonb(q) ->> 'customer_id') in (
     select mc2.customer_id::text from public.manager_customers mc2 where mc2.manager_id::text = m.id::text
   )) as qr_by_customer_id,
  (select count(*) from public.building_qr_codes q
   where (to_jsonb(q) ->> 'customer_id') is null
     and exists (
       select 1 from public.manager_customers mc2
       join public.uk_customers c2 on c2.id::text = mc2.customer_id::text
       cross join lateral unnest(array[c2.name::text, c2.display_name::text]) as l2(value)
       where mc2.manager_id::text = m.id::text
         and nullif(btrim(l2.value), '') is not null
         and lower(coalesce(q.customer_name::text, '')) ~ ('(^|[^[:alnum:]])' || regexp_replace(lower(btrim(l2.value)), '([^[:alnum:][:space:]])', '\\\1', 'g') || '($|[^[:alnum:]])')
     )) as qr_by_name,
  (select count(*) from public.time_attendance ta
   where ta.clock_in > now() - interval '90 days'
     and exists (
       select 1 from public.manager_customers mc2
       join public.uk_customers c2 on c2.id::text = mc2.customer_id::text
       cross join lateral unnest(array[c2.name::text, c2.display_name::text]) as l2(value)
       where mc2.manager_id::text = m.id::text
         and nullif(btrim(l2.value), '') is not null
         and (lower(coalesce(ta.customer_name::text, '')) ~ ('(^|[^[:alnum:]])' || regexp_replace(lower(btrim(l2.value)), '([^[:alnum:][:space:]])', '\\\1', 'g') || '($|[^[:alnum:]])')
              or lower(coalesce(ta.site_name::text, '')) ~ ('(^|[^[:alnum:]])' || regexp_replace(lower(btrim(l2.value)), '([^[:alnum:][:space:]])', '\\\1', 'g') || '($|[^[:alnum:]])'))
     )) as attendance_90d
from public.managers m
join public.manager_customers mc on mc.manager_id::text = m.id::text
join public.uk_customers c on c.id::text = mc.customer_id::text
cross join lateral unnest(array[c.name::text, c.display_name::text]) as label(value)
where coalesce(m.role, 'manager') = 'manager'
  and nullif(btrim(label.value), '') is not null
group by m.id, m.username
order by 3, 4, m.username;

-- 10c. Name collisions. Migration 3 ABORTS and lists these (review
--      2026-11-04); any row here must be fixed first by renaming a customer or
--      giving it a more specific display name:
--      (a) a client login's client name/display name matches, as a whole word,
--          another customer's name/display name it is not linked to;
--      (b) it matches the customer_name of a QR code whose customer_id is
--          another customer the login is not linked to;
--      (c) a client login's client name/display name is under 4 characters.
with client_links as (
  select distinct
    m.id::text as manager_id,
    coalesce(nullif(btrim(m.username::text), ''), m.id::text) as login,
    mc.customer_id::text as customer_id
  from public.managers m
  join public.manager_customers mc on mc.manager_id::text = m.id::text
  where coalesce(m.role, 'manager') = 'manager'
    and coalesce(m.is_active, true)
),
customer_labels as (
  select distinct c.id::text as customer_id, lower(btrim(l.value)) as label
  from public.uk_customers c
  cross join lateral unnest(array[c.name::text, c.display_name::text]) as l(value)
  where nullif(btrim(l.value), '') is not null
),
login_labels as (
  select cl.manager_id, cl.login, cl.customer_id, lab.label
  from client_links cl
  join customer_labels lab on lab.customer_id = cl.customer_id
),
not_linked as (
  select ll.*, other.customer_id as other_customer_id, other.label as other_label
  from login_labels ll
  join customer_labels other on other.customer_id <> ll.customer_id
  where not exists (
    select 1 from client_links x
    where x.manager_id = ll.manager_id and x.customer_id = other.customer_id
  )
)
select format('(c) %s: client label "%s" is under 4 characters', login, label) as problem
from login_labels
where length(label) < 4
union
select format('(a) %s: "%s" also matches customer "%s"', login, label, other_label)
from not_linked
where lower(coalesce(other_label, '')) ~ ('(^|[^[:alnum:]])' || regexp_replace(label, '([^[:alnum:][:space:]])', '\\\1', 'g') || '($|[^[:alnum:]])')
union
select format('(b) %s: "%s" also matches QR %s (customer_name "%s") of another customer',
              ll.login, ll.label, q.qr_code_id, q.customer_name)
from login_labels ll
join public.building_qr_codes q
  on (to_jsonb(q) ->> 'customer_id') is not null
 and (to_jsonb(q) ->> 'customer_id') <> ll.customer_id
 and lower(coalesce(q.customer_name::text, '')) ~ ('(^|[^[:alnum:]])' || regexp_replace(ll.label, '([^[:alnum:][:space:]])', '\\\1', 'g') || '($|[^[:alnum:]])')
where not exists (
  select 1 from client_links x
  where x.manager_id = ll.manager_id and x.customer_id = (to_jsonb(q) ->> 'customer_id')
)
order by 1;

-- 11. Rows that cannot be placed at any site, so become invisible to client
--     logins after migration 3 (last 90 days). Big numbers here mean the
--     site fields are not filled in the way migration 3 assumes.
select 'building_qr_codes without customer_name' as what, count(*) as n
from public.building_qr_codes where nullif(btrim(customer_name::text), '') is null
union all
select 'time_attendance (90d) without customer_name and site_name', count(*)
from public.time_attendance
where clock_in > now() - interval '90 days'
  and nullif(btrim(customer_name::text), '') is null and nullif(btrim(site_name::text), '') is null
union all
select 'task selections (90d) without qr_code_id', count(*)
from public.uk_cleaner_task_selections
where "timestamp" > now() - interval '90 days' and qr_code_id is null;

-- 11b. cleaner_logs: migration 3 places a scan log by
--      device_info->'qr_code_scanned'->>'id'. This shows how many recent logs
--      carry such an id, and how many of those ids exist in building_qr_codes.
--      (Errors if device_info is not json/jsonb; see section 7.)
select
  count(*) as logs_7d,
  count(*) filter (where cl.device_info -> 'qr_code_scanned' ->> 'id' is not null) as with_scanned_id,
  count(*) filter (where exists (
    select 1 from public.building_qr_codes q
    where q.qr_code_id::text = cl.device_info -> 'qr_code_scanned' ->> 'id'
  )) as scanned_id_is_known_qr
from public.cleaner_logs cl
where cl."timestamp" > now() - interval '7 days';

-- 12. Names migrations 1, 3 and 4 create; should be empty on a first run.
select 'table' as kind, to_regclass('backup.dropped_routines_20261104')::text as existing
union all
select 'function', p.oid::regprocedure::text
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('is_client_manager', 'client_manager_customer_labels', 'client_manager_labels_match',
                    'client_manager_qr_ids', 'client_manager_visible_cleaner_ids');

-- 13. Indexes the new policies lean on. Want: an index on qr_code_id for
--     uk_cleaner_task_photos (12 GB) and uk_cleaner_task_selections. Without
--     one, a client login's unfiltered read of photos filters by QR after
--     whatever scan its own WHERE clause allows -- same as today.
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('uk_cleaner_task_photos', 'uk_cleaner_task_selections', 'cleaner_logs',
                    'time_attendance', 'building_qr_codes', 'cleaners')
order by tablename, indexname;

-- 14. Task-photo bucket objects are NOT scoped by these migrations: paths are
--     <cleaner_id>/<uuid>.jpg, with no site in them. Sample, to confirm.
select name, created_at
from storage.objects
where bucket_id = 'task-photos'
order by created_at desc
limit 5;

rollback;
