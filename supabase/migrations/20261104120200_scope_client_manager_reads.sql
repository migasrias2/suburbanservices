-- FLAREN-109, part 3. RISKIER: written without access to the live database.
-- Apply only after reading the preflight output (sections 7-13), ideally on a
-- branch database first.
--
-- Client request (2026-11-04): a client login must only see its own site's
-- data. Today the policies on the activity tables let any 'manager' read every
-- row (e.g. task_photos_own_or_management: has_app_role(manager, ops_manager,
-- admin)), and the app's client-side filtering is not a security boundary.
--
-- Scoping is by SITE, not by linked cleaner (decision 2026-11-04): showgrounds
-- use temporary event staff an admin never links, and cleaner-based RLS would
-- hide them. A client login -- a managers row with role 'manager' that is not
-- also an ops_manager or admin -- reads:
--   * uk_cleaner_task_selections, uk_cleaner_task_photos: rows whose qr_code_id
--     is one of its clients' QR codes;
--   * cleaner_logs: rows whose scanned QR (device_info->'qr_code_scanned'->>'id',
--     because cleaner_logs.qr_code_id is never filled in) is one of them;
--   * time_attendance (customer_name, site_name), bathroom_assist_requests
--     (customer_name, location_label), live_tracking (customer_name, site_area,
--     site_id): rows where one of those fields contains a client's name or
--     display name, case-insensitively. Same rule as the app's matcher
--     (src/lib/managerScope.ts buildCustomerScopeMatcher).
-- "Its clients" = manager_customers rows for auth.uid(), joined to uk_customers.
-- A client's QR codes = building_qr_codes whose customer_name contains one of
-- those names (plus customer_id, if that column exists).
--
-- How: one RESTRICTIVE select policy per table, ANDed with the existing
-- permissive policies, so it can only hide rows from client logins. Admins, ops
-- managers, cleaners, anon (the public /bathroom-assist page), service_role and
-- cron see exactly what they saw before: for them the policy's first branch,
-- `not (select is_client_manager())`, is a once-per-query constant true.
--
-- Performance (uk_cleaner_task_photos is ~12 GB): the client's QR ids and names
-- are computed ONCE per query as an InitPlan array by SECURITY DEFINER STABLE
-- helpers; the per-row test is `qr_code_id = any(<small array>)`, with no
-- per-row subquery or function call against another table.
--
-- Known consequences (fail closed):
--   * a client login with no manager_customers rows reads nothing from these
--     tables. The app's legacy hardcoded scopes (AvTrade, PSM in
--     src/lib/managerScope.ts) are not visible to SQL, so this migration ABORTS
--     if any of those logins is active without manager_customers rows: link
--     them on Admin > Dashboard Access first;
--   * a cleaner_logs row without a scanned QR id, and a task row without
--     qr_code_id, are invisible to client logins;
--   * name matching is a "contains" test, so a client called "PSM" also matches
--     "PSM Marine North". That is the app's existing behaviour.
--
-- Not covered here: the cleaners directory (separate migration
-- 20261104120300) and the task-photos storage bucket. Bucket paths are
-- `<cleaner_id>/<uuid>.jpg` and carry no site, so scoping them would need a
-- per-object lookup into the 12 GB photos table by storage_path; left as is.
--
-- Defensive about unknown live state: missing tables/columns are skipped with
-- a WARNING; RLS is never switched on (a table with it off is skipped with a
-- WARNING); column types are read from the catalog; and the migration ABORTS
-- if authenticated has the privileges of a target table's owner without FORCE
-- ROW LEVEL SECURITY, because the owner bypass would make the policy a no-op.

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

-- Owner bypass (B2): a policy does nothing for a login that has the table
-- owner's privileges unless RLS is forced.
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

-- Superseded helpers from an earlier, cleaner-based draft of this migration.
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

-- True when any value contains any label (labels already lower-cased). Pure,
-- so the planner can treat it as cheap; no table access.
create or replace function public.client_manager_labels_match(p_values text[], p_labels text[])
returns boolean
language sql
immutable
parallel safe
set search_path to 'public'
as $$
  select exists (
    select 1
    from unnest(p_labels) as label(value)
    join unnest(p_values) as field(value)
      on field.value is not null
     and position(label.value in lower(field.value)) > 0
  );
$$;

-- The calling login's clients' QR code ids. building_qr_codes.customer_id is
-- matched too when the live table has it.
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
        and (
          public.client_manager_labels_match(array[q.customer_name::text], scope.labels)
          %s
        );
    $body$
  $f$,
  case when v_has_customer_id then 'or q.customer_id::text = any (scope.customer_ids)' else '' end);
end
$$;

revoke all on function public.is_client_manager() from public, anon;
revoke all on function public.client_manager_customer_labels() from public, anon;
revoke all on function public.client_manager_qr_ids() from public, anon;
grant execute on function public.is_client_manager() to authenticated;
grant execute on function public.client_manager_customer_labels() to authenticated;
grant execute on function public.client_manager_qr_ids() to authenticated;
grant execute on function public.client_manager_labels_match(text[], text[]) to authenticated;

-- One policy per table. Each target lists the QR columns and/or name columns
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
      ('uk_cleaner_task_selections', array['qr_code_id'],  array[]::text[]),
      ('uk_cleaner_task_photos',     array['qr_code_id'],  array[]::text[]),
      ('cleaner_logs',               array['qr_code_id', 'device_info'], array[]::text[]),
      ('time_attendance',            array[]::text[],      array['customer_name', 'site_name']),
      ('bathroom_assist_requests',   array[]::text[],      array['customer_name', 'location_label']),
      ('live_tracking',              array[]::text[],      array['customer_name', 'site_area', 'site_id'])
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
        -- Plain column = any(array) keeps any index on the column usable.
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

    -- Drop superseded policy names from the earlier draft as well.
    execute format('drop policy if exists %I on %s', 'client_manager_reads_own_cleaners', v_rel);
    execute format('drop policy if exists %I on %s', 'client_manager_reads_own_customers', v_rel);
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
