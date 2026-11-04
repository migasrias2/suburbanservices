-- FLAREN-109, part 4. RISKIER, and separate on purpose: written blind, and it
-- puts a scan of time_attendance and uk_cleaner_task_selections behind every
-- read of the cleaners table by a client login. Apply after part 3 (it uses
-- part 3's helpers), and check preflight section 13 for the indexes first.
--
-- Today any 'manager' can read every cleaner's name, mobile number and email
-- (policy cleaners_select_self_or_management). After this, a client login --
-- role 'manager', not also ops_manager or admin -- reads only cleaners who are
-- connected to one of its sites:
--   * linked to it in manager_cleaners (the dashboard roster), or
--   * linked to one of its clients in cleaner_customers, or
--   * with a time_attendance row whose customer_name/site_name names one of its
--     clients, or
--   * with a uk_cleaner_task_selections row on one of its clients' QR codes.
-- Plus its own row, if it has one. Everyone else is unaffected: the policy is
-- RESTRICTIVE and its first branch is a once-per-query constant for them.
--
-- The visible set is computed once per query (InitPlan) by a SECURITY DEFINER
-- helper; the per-row test on cleaners is a membership check in that array.
-- The helper itself reads every time_attendance row (name match, no index can
-- help) and the selections on the client's QR ids (uses an index on
-- qr_code_id if there is one). Fine at today's ~2k attendance rows; revisit if
-- client dashboards slow down.

do $$
begin
  if to_regprocedure('public.client_manager_qr_ids()') is null
     or to_regprocedure('public.client_manager_customer_labels()') is null
     or to_regprocedure('public.is_client_manager()') is null then
    raise exception 'Apply 20261104120200_scope_client_manager_reads.sql first';
  end if;
  if to_regclass('public.cleaners') is null then
    raise exception 'public.cleaners does not exist';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.cleaners'::regclass) then
    raise exception 'public.cleaners has RLS disabled; this policy would do nothing. Nothing was changed.';
  end if;
  if exists (
    select 1 from pg_class c
    where c.oid = 'public.cleaners'::regclass
      and not c.relforcerowsecurity
      and pg_has_role('authenticated', c.relowner, 'USAGE')
  ) then
    raise exception 'authenticated has the owner''s privileges on public.cleaners and RLS is not forced; this policy would do nothing. Nothing was changed.';
  end if;
end
$$;

-- Built dynamically: cleaner_customers and the selections table may be absent
-- live. Ids are cast to uuid only when they look like one, so a stray legacy
-- value cannot make client reads fail.
do $$
declare
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_parts   text[] := array[]::text[];
begin
  if to_regclass('public.manager_cleaners') is not null then
    v_parts := v_parts || format($p$
      select case when mcl.cleaner_id::text ~ %L then mcl.cleaner_id::text::uuid end
      from public.manager_cleaners mcl
      where mcl.manager_id::text = auth.uid()::text$p$, v_uuid_re);
  end if;

  if to_regclass('public.cleaner_customers') is not null then
    v_parts := v_parts || format($p$
      select case when cc.cleaner_id::text ~ %L then cc.cleaner_id::text::uuid end
      from public.cleaner_customers cc
      join public.manager_customers mc on mc.customer_id::text = cc.customer_id::text
      where mc.manager_id::text = auth.uid()::text$p$, v_uuid_re);
  end if;

  if to_regclass('public.time_attendance') is not null then
    v_parts := v_parts || $p$
      select ta.cleaner_uuid
      from public.time_attendance ta, scope
      where ta.cleaner_uuid is not null
        and public.client_manager_labels_match(array[ta.customer_name::text, ta.site_name::text], scope.labels)$p$::text;
  end if;

  if to_regclass('public.uk_cleaner_task_selections') is not null then
    v_parts := v_parts || format($p$
      select case when s.cleaner_id::text ~ %L then s.cleaner_id::text::uuid end
      from public.uk_cleaner_task_selections s, scope
      where s.qr_code_id::text = any (scope.qr_ids)$p$, v_uuid_re);
  end if;

  if cardinality(v_parts) = 0 then
    raise exception 'None of manager_cleaners, cleaner_customers, time_attendance, uk_cleaner_task_selections exist; nothing to scope by';
  end if;

  execute format($f$
    create or replace function public.client_manager_visible_cleaner_ids()
    returns uuid[]
    language sql
    stable
    security definer
    set search_path to 'public'
    as $body$
      with scope as (
        select public.client_manager_customer_labels() as labels,
               public.client_manager_qr_ids() as qr_ids
      )
      select coalesce(array_agg(distinct x.id) filter (where x.id is not null), '{}'::uuid[])
      from (%s) as x(id);
    $body$
  $f$, array_to_string(v_parts, E'\n      union\n'));
end
$$;

revoke all on function public.client_manager_visible_cleaner_ids() from public, anon;
grant execute on function public.client_manager_visible_cleaner_ids() to authenticated;

drop policy if exists client_manager_reads_own_site_cleaners on public.cleaners;
create policy client_manager_reads_own_site_cleaners
  on public.cleaners
  as restrictive
  for select
  to authenticated
  using (
    not (select public.is_client_manager())
    or id::text = (select auth.uid())::text
    or id::text = any ((select public.client_manager_visible_cleaner_ids())::text[])
  );

comment on policy client_manager_reads_own_site_cleaners on public.cleaners is
  'FLAREN-109: client logins (role manager) read only cleaners linked to them or seen at their clients'' sites. Restrictive; other roles unaffected.';
