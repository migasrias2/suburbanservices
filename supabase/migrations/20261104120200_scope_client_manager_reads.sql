-- FLAREN-109, part 3 of 3. RISKIER: written without access to the live
-- database. Apply only after reading the preflight output (sections 7-11), and
-- ideally on a branch database first.
--
-- Client request (2026-11-04): a client login must only see its own site's
-- data. Today the policies on the activity tables let any 'manager' read every
-- row (e.g. task_photos_own_or_management: has_app_role(manager, ops_manager,
-- admin)), and the app's client-side filtering is not a security boundary: the
-- browser can query these tables directly with its own session.
--
-- What this does: adds a RESTRICTIVE select policy to each activity table so a
-- client login -- a managers row with role 'manager' that is not also an admin
-- or ops_manager -- only reads rows for the cleaners linked to it in
-- manager_cleaners (or, for assist requests, for its own clients in
-- manager_customers). Restrictive policies are ANDed with the existing
-- permissive ones, so this can only hide rows from client logins. Cleaners, ops
-- managers, admins, anon (the public assist-report page), the service role and
-- the cron jobs see exactly what they saw before.
--
-- Known consequences, by design (fail closed):
--   * a client login with no manager_cleaners rows reads nothing from the
--     cleaner-keyed tables. The three hardcoded MANAGER_CLEANER_FALLBACKS in
--     src/services/managerService.ts are seeded into manager_cleaners below so
--     those clients keep their cleaners;
--   * a client login with no manager_customers rows reads no assist requests.
--     The legacy hardcoded scopes in src/lib/managerScope.ts (AvTrade, PSM) are
--     NOT in manager_customers unless an admin has linked them -- check
--     preflight section 10 before applying;
--   * attendance rows with a NULL cleaner_uuid (legacy rows) become invisible to
--     client logins; preflight section 11 counts them;
--   * scoping is by cleaner, not by site: a cleaner who works for two clients
--     shows both clients' rows to both client logins. The app's client-side
--     site filter still applies on top. Closing that needs a site key on each
--     row, which these tables do not reliably have.
--
-- Defensive about unknown live state: a missing table or column is skipped with
-- a WARNING, RLS is never switched on here (if a table has it off, this is
-- skipped and a WARNING names it), and the cleaner column's type is read from
-- the catalog rather than assumed.

do $$
begin
  if to_regprocedure('public.has_app_role(text[])') is null then
    raise exception 'public.has_app_role(text[]) is missing; this migration relies on it';
  end if;
  if to_regclass('public.manager_cleaners') is null or to_regclass('public.manager_customers') is null then
    raise exception 'manager_cleaners / manager_customers are missing; cannot scope client logins';
  end if;
end
$$;

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

-- The cleaners linked to the calling login. Empty for everyone else.
create or replace function public.client_manager_cleaner_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct mc.cleaner_id::uuid), '{}'::uuid[])
  from public.manager_cleaners mc
  where mc.manager_id::text = auth.uid()::text
    and mc.cleaner_id is not null;
$$;

-- True when any of the given labels names one of the calling login's clients.
-- Mirrors the app's matcher (src/lib/managerScope.ts): a case-insensitive
-- "contains" on the client's name or display name.
create or replace function public.client_manager_sees_customer(variadic p_labels text[])
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.manager_customers mc
    join public.uk_customers c on c.id::text = mc.customer_id::text
    cross join lateral unnest(array[c.name::text, c.display_name::text]) as token(value)
    cross join lateral unnest(p_labels) as label(value)
    where mc.manager_id::text = auth.uid()::text
      and nullif(btrim(token.value), '') is not null
      and nullif(btrim(label.value), '') is not null
      and position(lower(btrim(token.value)) in lower(label.value)) > 0
  );
$$;

revoke all on function public.is_client_manager() from public, anon;
revoke all on function public.client_manager_cleaner_ids() from public, anon;
revoke all on function public.client_manager_sees_customer(text[]) from public, anon;
grant execute on function public.is_client_manager() to authenticated;
grant execute on function public.client_manager_cleaner_ids() to authenticated;
grant execute on function public.client_manager_sees_customer(text[]) to authenticated;

-- The app's hardcoded cleaner fallbacks (managerService.ts
-- MANAGER_CLEANER_FALLBACKS) become real rows, so the policies below do not
-- blank those clients. Inserted only when both people exist and the link is new.
insert into public.manager_cleaners (manager_id, cleaner_id)
select v.manager_id::uuid, v.cleaner_id::uuid
from (values
  ('4d1381ae-332f-4ff4-8ae3-f062dd5b487f', 'dfaf59c4-1093-44c6-844f-7dea4885547e'),
  ('6d72f75b-9baa-4577-ba92-16c1a5474f44', 'b7a454ee-7505-43bf-958c-4d82d1428e8c'),
  ('bcda2a69-79ee-45e5-8ee6-c2a132beb576', 'b7a454ee-7505-43bf-958c-4d82d1428e8c')
) as v(manager_id, cleaner_id)
where exists (select 1 from public.managers m where m.id::text = v.manager_id)
  and exists (select 1 from public.cleaners cl where cl.id::text = v.cleaner_id)
  and not exists (
    select 1 from public.manager_cleaners mc
    where mc.manager_id::text = v.manager_id and mc.cleaner_id::text = v.cleaner_id
  );

do $$
declare
  v_targets text[][] := array[
    array['time_attendance',            'cleaner_uuid'],
    array['cleaner_logs',               'cleaner_id'],
    array['uk_cleaner_task_selections', 'cleaner_id'],
    array['uk_cleaner_task_photos',     'cleaner_id'],
    array['live_tracking',              'cleaner_id']
  ];
  v_policy constant text := 'client_manager_reads_own_cleaners';
  v_table  text;
  v_column text;
  v_rel    regclass;
  v_rls    boolean;
  v_type   text;
  v_match  text;
  i        int;
begin
  for i in 1 .. array_length(v_targets, 1) loop
    v_table  := v_targets[i][1];
    v_column := v_targets[i][2];
    v_rel    := to_regclass(format('public.%I', v_table));

    if v_rel is null then
      raise warning 'public.% does not exist; not scoped', v_table;
      continue;
    end if;

    select c.relrowsecurity into v_rls from pg_class c where c.oid = v_rel;

    select format_type(a.atttypid, a.atttypmod) into v_type
    from pg_attribute a
    where a.attrelid = v_rel and a.attname = v_column and not a.attisdropped;

    if v_type is null then
      raise warning '%.% does not exist; % not scoped', v_rel, v_column, v_rel;
      continue;
    end if;

    if not v_rls then
      raise warning '% has RLS disabled; not scoped (enabling it blind could block every read)', v_rel;
      continue;
    end if;

    -- uuid columns compare directly so the cleaner_id index stays usable. The
    -- cast keeps `(select ...)` a scalar initplan (evaluated once per query)
    -- rather than an ANY-subquery over arrays.
    v_match := case
      when v_type = 'uuid' then format('%I = any ((select public.client_manager_cleaner_ids())::uuid[])', v_column)
      else format('%I::text = any ((select public.client_manager_cleaner_ids())::text[])', v_column)
    end;

    execute format('drop policy if exists %I on %s', v_policy, v_rel);
    execute format(
      'create policy %I on %s as restrictive for select to authenticated '
      'using (not (select public.is_client_manager()) or %s)',
      v_policy, v_rel, v_match
    );
    execute format(
      'comment on policy %I on %s is %L',
      v_policy, v_rel,
      'FLAREN-109: client logins (role manager) read only rows for cleaners linked in manager_cleaners. Restrictive; other roles unaffected.'
    );
  end loop;
end
$$;

do $$
declare
  v_rel    regclass := to_regclass('public.bathroom_assist_requests');
  v_policy constant text := 'client_manager_reads_own_customers';
  v_rls    boolean;
begin
  if v_rel is null then
    raise warning 'public.bathroom_assist_requests does not exist; not scoped';
    return;
  end if;

  if (
    select count(*) from pg_attribute a
    where a.attrelid = v_rel and a.attname in ('customer_name', 'location_label') and not a.attisdropped
  ) < 2 then
    raise warning 'bathroom_assist_requests lacks customer_name/location_label; not scoped';
    return;
  end if;

  select c.relrowsecurity into v_rls from pg_class c where c.oid = v_rel;
  if not v_rls then
    raise warning 'bathroom_assist_requests has RLS disabled; not scoped';
    return;
  end if;

  execute format('drop policy if exists %I on %s', v_policy, v_rel);
  execute format(
    'create policy %I on %s as restrictive for select to authenticated '
    'using (not (select public.is_client_manager()) '
    'or public.client_manager_sees_customer(customer_name::text, location_label::text))',
    v_policy, v_rel
  );
  execute format(
    'comment on policy %I on %s is %L',
    v_policy, v_rel,
    'FLAREN-109: client logins (role manager) read only requests for their own clients in manager_customers. Restrictive; other roles unaffected.'
  );
end
$$;
