-- FLAREN-109, part 3. RISKIER: written without access to the live database.
-- Apply only after reading the preflight output (sections 7-11), ideally on a
-- branch database first.
--
-- Client request (2026-11-04): a client login must only see its own site's
-- data. Today the policies on the activity tables let any 'manager' read every
-- row (e.g. task_photos_own_or_management: has_app_role(manager, ops_manager,
-- admin)), and the app's client-side filtering is not a security boundary.
--
-- Scoping is by SITE, not by linked cleaner (decision 2026-11-04): showgrounds
-- use temporary event staff an admin never links. A client login -- a managers
-- row with role 'manager' that is not also an ops_manager or admin -- reads:
--   * uk_cleaner_task_selections, uk_cleaner_task_photos: rows whose qr_code_id
--     is one of its clients' QR codes;
--   * cleaner_logs: rows whose scanned QR (device_info->'qr_code_scanned'->>'id';
--     cleaner_logs.qr_code_id is never filled in) is one of them, or whose
--     customer_name / site_area names one of its clients;
--   * time_attendance (customer_name, site_name), bathroom_assist_requests
--     (customer_name, location_label), live_tracking (customer_name,
--     site_area): rows where one of those fields names one of its clients.
-- "Its clients" = manager_customers rows for auth.uid(), joined to uk_customers.
-- "Its QR codes" = building_qr_codes whose customer_id is one of its clients;
-- the name match below is only a fallback for QR rows with no customer_id (or
-- when the live table has no customer_id column).
--
-- "Names one of its clients" is a whole-word, case-insensitive match of the
-- client's name or display name: "SEAS" matches "SEAS Main Ring" but not
-- "Overseas" or "Seasonal Kitchen". It is stricter than the app's substring
-- matcher; preflight 10b shows what each client login still matches.
-- Whole words still let "Adams" match "Adams Foods", so the migration ABORTS
-- and lists them if (review 2026-11-04):
--   (a) a client login's client name/display name matches another customer's
--       name/display name that the login is not linked to;
--   (b) it matches the customer_name of a QR code whose customer_id belongs to
--       a customer the login is not linked to;
--   (c) a client login's client name/display name is under 4 characters.
-- Fix by renaming or giving the customer a more specific display name.
--
-- How: one RESTRICTIVE select policy per table, ANDed with the existing
-- permissive policies, so it can only hide rows from client logins. Admins, ops
-- managers, cleaners, anon (the public /bathroom-assist page), service_role and
-- cron see exactly what they saw before: for them the first branch,
-- `not (select is_client_manager())`, is a once-per-query constant true.
--
-- Performance (uk_cleaner_task_photos is ~12 GB): the client's QR ids and
-- names are computed ONCE per query as InitPlan arrays by SECURITY DEFINER
-- STABLE helpers. The per-row test is `qr_code_id = any(<small array>)` or a
-- regex over a few short labels -- never a per-row query of another table. The
-- policy cannot itself drive an index scan (it is an OR with the role check);
-- a client's queries use whatever their own WHERE clause allows, as today.
--
-- Known consequences (fail closed):
--   * a client login with no manager_customers rows reads nothing here. The
--     app's legacy hardcoded scopes (AvTrade, PSM in src/lib/managerScope.ts)
--     are invisible to SQL, so this ABORTS if one of those logins is active
--     without manager_customers rows: link them on Admin > Dashboard Access;
--   * task rows without qr_code_id are invisible to client logins.
--
-- Not covered here: the cleaners directory (separate migration
-- 20261104120300) and the task-photos storage bucket (paths are
-- `<cleaner_id>/<uuid>.jpg`, no site in them).
--
-- Defensive about unknown live state: missing tables/columns are skipped with
-- a WARNING; RLS is never switched on (a table with it off is skipped with a
-- WARNING); column types are read from the catalog; and it ABORTS if
-- authenticated has a target table owner's privileges without FORCE ROW LEVEL
-- SECURITY, because the owner bypass would make the policy a no-op.

do $$
begin
  if to_regprocedure('public.has_app_role(text[])') is null then
    raise exception 'public.has_app_role(text[]) is missing; this migration relies on it';
  end if;
  if to_regclass('public.manager_customers') is null
     or to_regclass('public.uk_customers') is null
     or to_regclass('public.building_qr_codes') is null then
    raise exception 'manager_customers / uk_customers / building_qr_codes missing; cannot scope client logins by site';
  end if;
end
$$;

-- Owner bypass: a policy does nothing for a login that has the table owner's
-- privileges unless RLS is forced.
do $$
declare
  v_bypassed text[];
begin
  select array_agg(c.oid::regclass::text order by c.relname)
    into v_bypassed
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and c.relname in ('time_attendance', 'cleaner_logs', 'uk_cleaner_task_selections',
                      'uk_cleaner_task_photos', 'live_tracking', 'bathroom_assist_requests')
    and not c.relforcerowsecurity
    and pg_has_role('authenticated', c.relowner, 'USAGE');

  if v_bypassed is not null then
    raise exception
      'authenticated has the owner''s privileges on % and RLS is not forced there, so these policies would do nothing. See preflight sections 3-4. Nothing was changed.',
      v_bypassed;
  end if;
end
$$;

-- Legacy hardcoded client logins must be linked in the database first, or
-- this migration would blank them while the app still shows them as linked.
do $$
declare
  v_unlinked text[];
begin
  select array_agg(coalesce(nullif(btrim(m.username::text), ''), m.id::text))
    into v_unlinked
  from public.managers m
  where m.id::text in ('df0bf2e7-1a07-4876-949c-6cfe8fe0fac6',   -- AvTrade
                       'ce2c8d1a-6e0a-4d78-9746-2cd32983455f',   -- PSM
                       'bffb28ae-5ed3-46f2-8ec9-9864fab34301')   -- PSM
    and coalesce(m.is_active, true)
    and not exists (
      select 1 from public.manager_customers mc where mc.manager_id::text = m.id::text
    );

  if v_unlinked is not null then
    raise exception
      'Legacy client logins % have no manager_customers rows and would see nothing. Assign their client on Admin > Dashboard Access, then re-run. Nothing was changed.',
      v_unlinked;
  end if;
end
$$;

-- Remove an earlier draft of this migration, if it was applied: its policies
-- first, then the helpers they depend on.
do $$
declare
  v_table text;
  v_rel   regclass;
begin
  foreach v_table in array array['time_attendance', 'cleaner_logs', 'uk_cleaner_task_selections',
                                 'uk_cleaner_task_photos', 'live_tracking', 'bathroom_assist_requests'] loop
    v_rel := to_regclass(format('public.%I', v_table));
    continue when v_rel is null;
    execute format('drop policy if exists %I on %s', 'client_manager_reads_own_cleaners', v_rel);
    execute format('drop policy if exists %I on %s', 'client_manager_reads_own_customers', v_rel);
  end loop;
end
$$;
drop function if exists public.client_manager_cleaner_ids();
drop function if exists public.client_manager_sees_customer(text[]);

-- A client login: role 'manager' by table membership, and not also an
-- ops_manager or admin (those stay global).
create or replace function public.is_client_manager()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.has_app_role(array['manager'])
     and not public.has_app_role(array['ops_manager', 'admin']);
$$;

-- True when any value contains any label as a whole word, case-insensitively.
-- Labels must already be lower-cased. Built-ins only and no search_path
-- setting, so the planner can inline it.
create or replace function public.client_manager_labels_match(p_values text[], p_labels text[])
returns boolean
language sql
immutable
parallel safe
as $$
  select exists (
    select 1
    from unnest(p_labels) as label(value)
    join unnest(p_values) as field(value)
      on field.value is not null
     and lower(field.value) ~ (
           '(^|[^[:alnum:]])'
           || regexp_replace(label.value, '([^[:alnum:][:space:]])', '\\\1', 'g')
           || '($|[^[:alnum:]])'
         )
  );
$$;

-- Lower-cased names and display names of the calling login's clients.
create or replace function public.client_manager_customer_labels()
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct lower(btrim(label.value))), '{}'::text[])
  from public.manager_customers mc
  join public.uk_customers c on c.id::text = mc.customer_id::text
  cross join lateral unnest(array[c.name::text, c.display_name::text]) as label(value)
  where mc.manager_id::text = auth.uid()::text
    and nullif(btrim(label.value), '') is not null;
$$;

-- The calling login's clients' QR code ids: by customer_id where the live
-- table has that column, by name only for QR rows without one.
do $$
declare
  v_has_customer_id boolean := exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.building_qr_codes'::regclass
      and a.attname = 'customer_id' and not a.attisdropped
  );
begin
  execute format($f$
    create or replace function public.client_manager_qr_ids()
    returns text[]
    language sql
    stable
    security definer
    set search_path to 'public'
    as $body$
      with scope as (
        select public.client_manager_customer_labels() as labels,
               array(select mc.customer_id::text from public.manager_customers mc
                     where mc.manager_id::text = auth.uid()::text) as customer_ids
      )
      select coalesce(array_agg(distinct q.qr_code_id::text), '{}'::text[])
      from public.building_qr_codes q, scope
      where q.qr_code_id is not null
        and %s;
    $body$
  $f$,
  case
    when v_has_customer_id then
      '(q.customer_id::text = any (scope.customer_ids)
        or (q.customer_id is null
            and public.client_manager_labels_match(array[q.customer_name::text], scope.labels)))'
    else
      'public.client_manager_labels_match(array[q.customer_name::text], scope.labels)'
  end);
end
$$;

revoke all on function public.is_client_manager() from public, anon;
revoke all on function public.client_manager_customer_labels() from public, anon;
revoke all on function public.client_manager_qr_ids() from public, anon;
grant execute on function public.is_client_manager() to authenticated;
grant execute on function public.client_manager_customer_labels() to authenticated;
grant execute on function public.client_manager_qr_ids() to authenticated;
grant execute on function public.client_manager_labels_match(text[], text[]) to authenticated;

-- Name collisions (review 2026-11-04). Same query as preflight section 10c.
do $$
declare
  v_problems text[];
begin
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
  select array_agg(problem order by problem) into v_problems
  from (
    select format('(c) %s: client label "%s" is under 4 characters', login, label) as problem
    from login_labels
    where length(label) < 4
    union
    select format('(a) %s: "%s" also matches customer "%s"', login, label, other_label)
    from not_linked
    where public.client_manager_labels_match(array[other_label], array[label])
    union
    select format('(b) %s: "%s" also matches QR %s (customer_name "%s") of another customer',
                  ll.login, ll.label, q.qr_code_id, q.customer_name)
    from login_labels ll
    join public.building_qr_codes q
      on (to_jsonb(q) ->> 'customer_id') is not null
     and (to_jsonb(q) ->> 'customer_id') <> ll.customer_id
     and public.client_manager_labels_match(array[q.customer_name::text], array[ll.label])
    where not exists (
      select 1 from client_links x
      where x.manager_id = ll.manager_id and x.customer_id = (to_jsonb(q) ->> 'customer_id')
    )
  ) as problems;

  if v_problems is not null then
    raise exception
      E'Client names would match other customers'' data, so client logins could read it. Rename or set a more specific display name, then re-run. Nothing was changed.\n%',
      array_to_string(v_problems, E'\n');
  end if;
end
$$;

-- One policy per table. Each target lists the QR columns and the name columns
-- that may place a row at a client's site; only those that exist are used.
do $$
declare
  v_policy constant text := 'client_manager_reads_own_sites';
  r        record;
  v_rel    regclass;
  v_rls    boolean;
  v_col    text;
  v_type   text;
  v_terms  text[];
  v_names  text[];
begin
  for r in
    select * from (values
      ('uk_cleaner_task_selections', array['qr_code_id'],                array[]::text[]),
      ('uk_cleaner_task_photos',     array['qr_code_id'],                array[]::text[]),
      ('cleaner_logs',               array['qr_code_id', 'device_info'], array['customer_name', 'site_area']),
      ('time_attendance',            array[]::text[],                    array['customer_name', 'site_name']),
      ('bathroom_assist_requests',   array[]::text[],                    array['customer_name', 'location_label']),
      ('live_tracking',              array[]::text[],                    array['customer_name', 'site_area'])
    ) as t(table_name, qr_columns, name_columns)
  loop
    v_rel := to_regclass(format('public.%I', r.table_name));
    if v_rel is null then
      raise warning 'public.% does not exist; not scoped', r.table_name;
      continue;
    end if;

    select c.relrowsecurity into v_rls from pg_class c where c.oid = v_rel;
    if not v_rls then
      raise warning '% has RLS disabled; not scoped (enabling it blind could block every read). Client logins can read every row.', v_rel;
      continue;
    end if;

    v_terms := '{}';

    foreach v_col in array r.qr_columns loop
      select format_type(a.atttypid, a.atttypmod) into v_type
      from pg_attribute a
      where a.attrelid = v_rel and a.attname = v_col and not a.attisdropped;

      if v_type is null then
        continue;
      elsif v_col = 'device_info' then
        if v_type in ('json', 'jsonb') then
          v_terms := v_terms || format(
            '((%I -> ''qr_code_scanned'') ->> ''id'') = any ((select public.client_manager_qr_ids())::text[])', v_col);
        else
          raise warning '%.device_info is %, not json/jsonb; scanned QR not used', v_rel, v_type;
        end if;
      elsif v_type = 'text' then
        v_terms := v_terms || format('%I = any ((select public.client_manager_qr_ids())::text[])', v_col);
      else
        v_terms := v_terms || format('%I::text = any ((select public.client_manager_qr_ids())::text[])', v_col);
      end if;
    end loop;

    select array_agg(format('%I::text', a.attname) order by array_position(r.name_columns, a.attname::text))
      into v_names
    from pg_attribute a
    where a.attrelid = v_rel and a.attname = any (r.name_columns) and not a.attisdropped;

    if v_names is not null then
      v_terms := v_terms || format(
        'public.client_manager_labels_match(array[%s], (select public.client_manager_customer_labels()))',
        array_to_string(v_names, ', '));
    end if;

    if cardinality(v_terms) = 0 then
      raise warning '% has none of the columns needed to place a row at a site; not scoped', v_rel;
      continue;
    end if;

    execute format('drop policy if exists %I on %s', v_policy, v_rel);
    execute format(
      'create policy %I on %s as restrictive for select to authenticated using (not (select public.is_client_manager()) or %s)',
      v_policy, v_rel, array_to_string(v_terms, ' or ')
    );
    execute format(
      'comment on policy %I on %s is %L',
      v_policy, v_rel,
      'FLAREN-109: client logins (role manager) read only rows at their own clients'' sites. Restrictive; other roles unaffected.'
    );
  end loop;
end
$$;

-- Report client logins that will read nothing (no manager_customers rows).
do $$
declare
  v_blank text[];
begin
  select array_agg(coalesce(nullif(btrim(m.username::text), ''), m.id::text) order by m.username)
    into v_blank
  from public.managers m
  where coalesce(m.role, 'manager') = 'manager'
    and coalesce(m.is_active, true)
    and not exists (select 1 from public.manager_customers mc where mc.manager_id::text = m.id::text);

  if v_blank is not null then
    raise warning 'Active client logins with no client assigned now read nothing: %', v_blank;
  end if;
end
$$;
