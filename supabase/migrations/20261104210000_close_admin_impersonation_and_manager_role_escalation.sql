-- Close three ways a signed-in non-admin could act as an admin.
--
-- 1. managers rows. Any signed-in user could insert a managers row for
--    themselves ("Authenticated can insert managers") or update their own
--    with no column limits, and nothing restricted `role`. has_app_role()
--    trusts managers.role, so a cleaner could write role = 'admin' and pass
--    every admin check. Accounts are only ever created by the admin-create-user
--    Edge Function (service role), so the self-insert policy is not needed.
--    Self-updates stay allowed, but id, role and active status can now only
--    be changed by an admin or the service role.
--
-- 2. admin_* functions. All 25 SECURITY DEFINER admin functions checked that
--    the p_admin_id ARGUMENT is an active admin, never that the caller is that
--    admin, and all are executable by `authenticated`. Anyone signed in could
--    pass the admin's id (visible to cleaners on corrected shifts) and
--    deactivate or rename users. Each check now also requires
--    p_admin_id = auth.uid(). The app already sends the session's own id
--    (src/lib/sessionIdentity.ts), so the real admin is unaffected.
--    Bodies are the live definitions (4 Nov 2026) with only that condition added.
--
-- 3. phone_account_duplicates lists staff names and phone numbers. It is a
--    plain view owned by postgres, so it bypassed RLS and anon could read it.
--    Nothing in the app reads it; only the service role keeps access.
--
-- Rollback: .context/clock-rebuild/sql/rollback-20261104210000.sql (workspace only).

begin;

drop policy if exists "Authenticated can insert managers" on public.managers;

alter table public.managers
  add constraint managers_role_allowed check (role in ('manager', 'ops_manager'));

create or replace function public.managers_guard_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Runs as the caller (not SECURITY DEFINER) so current_user is the API role.
  if current_user in ('authenticated', 'anon') and not public.has_app_role(array['admin']) then
    if new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.is_active is distinct from old.is_active then
      raise exception 'Only an admin can change a manager''s role or status'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists managers_guard_privileged_columns on public.managers;
create trigger managers_guard_privileged_columns
  before update on public.managers
  for each row execute function public.managers_guard_privileged_columns();

revoke all on public.phone_account_duplicates from anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_assign_cleaner_to_customer(p_admin_id uuid, p_cleaner_id uuid, p_customer_id uuid)
 RETURNS cleaner_customers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.cleaner_customers%rowtype;
  v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.cleaner_customers(cleaner_id, customer_id)
  values (p_cleaner_id, p_customer_id)
  on conflict (cleaner_id, customer_id) do update set created_at = cleaner_customers.created_at
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_assign_manager_to_customer(p_admin_id uuid, p_manager_id uuid, p_customer_id uuid)
 RETURNS manager_customers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.manager_customers%rowtype;
  v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.manager_customers(manager_id, customer_id)
  values (p_manager_id, p_customer_id)
  on conflict (manager_id, customer_id) do update set created_at = manager_customers.created_at
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_area(p_admin_id uuid, p_customer_id uuid, p_area_name text)
 RETURNS areas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_site_id uuid;
  v_area public.areas%rowtype;
  v_area_name text := trim(p_area_name);
  v_is_admin boolean;
  v_uk_name text;
begin
  if v_area_name is null or v_area_name = '' then
    raise exception 'area name required' using errcode = '23514';
  end if;

  select exists (
    select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true
  ) into v_is_admin;
  if not v_is_admin then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select coalesce(u.display_name, u.name)
    into v_uk_name
  from public.uk_customers u
  where u.id = p_customer_id;

  if v_uk_name is null then
    raise exception 'customer not found' using errcode = '23503';
  end if;

  -- Ensure a public.customers row exists for this id (FK target for sites.customer_id).
  -- customers.name has a unique constraint, so if the name is already taken by a
  -- different customers row, we disambiguate with a short suffix.
  if not exists (select 1 from public.customers where id = p_customer_id) then
    begin
      insert into public.customers(id, name, is_active)
      values (p_customer_id, v_uk_name, true);
    exception when unique_violation then
      insert into public.customers(id, name, is_active)
      values (p_customer_id, v_uk_name || ' [' || left(p_customer_id::text, 8) || ']', true);
    end;
  end if;

  select id into v_site_id
  from public.sites
  where customer_id = p_customer_id
  order by created_at asc
  limit 1;

  if v_site_id is null then
    insert into public.sites(customer_id, name, is_active)
    values (p_customer_id, 'Default Site', true)
    returning id into v_site_id;
  end if;

  select * into v_area
  from public.areas
  where site_id = v_site_id and lower(name) = lower(v_area_name)
  limit 1;

  if v_area.id is null then
    insert into public.areas(site_id, name, is_active)
    values (v_site_id, v_area_name, true)
    returning * into v_area;
  end if;

  return v_area;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_customer(p_admin_id uuid, p_name text)
 RETURNS uk_customers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin_id uuid;
  v_customer public.uk_customers%rowtype;
  v_name text := trim(p_name);
begin
  if v_name is null or v_name = '' then
    raise exception 'name required' using errcode = '23514';
  end if;

  select a.id into v_admin_id
  from public.admins a
  where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true
  limit 1;

  if v_admin_id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  begin
    insert into public.uk_customers(name, display_name, customer_name, is_active)
    values (v_name, v_name, v_name, true)
    returning * into v_customer;
  exception when unique_violation then
    select * into v_customer
    from public.uk_customers
    where lower(coalesce(display_name, name)) = lower(v_name)
    limit 1;
  end;

  return v_customer;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_preset(p_admin_id uuid, p_name text, p_items jsonb)
 RETURNS area_presets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_is_admin boolean; v_row public.area_presets%rowtype;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'name required' using errcode = '23514'; end if;
  insert into public.area_presets (name, items, created_by)
  values (trim(p_name), coalesce(p_items, '[]'::jsonb), p_admin_id)
  returning * into v_row;
  return v_row;
end; $function$;

CREATE OR REPLACE FUNCTION public.admin_deactivate_user(p_admin_id uuid, p_role text, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_role = 'cleaner' then
    update public.cleaners set is_active = false, updated_at = now() where id = p_user_id;
  elsif p_role in ('manager','ops_manager') then
    update public.managers set is_active = false, updated_at = now() where id = p_user_id;
    delete from public.manager_customers where manager_id = p_user_id;
  elsif p_role = 'admin' then
    if p_user_id = p_admin_id then raise exception 'cannot deactivate yourself' using errcode = '23514'; end if;
    update public.admins set is_active = false, updated_at = now() where id = p_user_id;
  else
    raise exception 'invalid role' using errcode = '22023';
  end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.admin_delete_preset(p_admin_id uuid, p_preset_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then raise exception 'not authorized' using errcode = '42501'; end if;
  delete from public.area_presets where id = p_preset_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.admin_list_all_users(p_admin_id uuid)
 RETURNS TABLE(user_id uuid, role text, first_name text, last_name text, identifier text, is_active boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select c.id, 'cleaner'::text, c.first_name, c.last_name, c.mobile_number, coalesce(c.is_active, true), c.created_at
    from public.cleaners c
    union all
    select m.id, coalesce(m.role, 'manager'), m.first_name, m.last_name,
           coalesce(nullif(m.username, ''), m.mobile_number), coalesce(m.is_active, true), m.created_at
    from public.managers m
    union all
    select a.id, 'admin'::text, a.first_name, a.last_name, a.username, coalesce(a.is_active, true), a.created_at
    from public.admins a
    order by 6 desc, 3 asc;
end; $function$;

CREATE OR REPLACE FUNCTION public.admin_list_area_tasks(p_admin_id uuid)
 RETURNS SETOF area_tasks
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.*
  from public.area_tasks t
  where exists (
    select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true
  )
  order by coalesce(nullif(t.customer_name,''),'Unassigned Customer') asc,
           coalesce(nullif(t.area,''),'Unassigned Area') asc,
           coalesce(t.sort_order, t.position, 2147483647) asc,
           t.created_at asc;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_customer_areas(p_admin_id uuid)
 RETURNS TABLE(customer_id uuid, customer_name text, area_id uuid, area_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id as customer_id,
         c.name as customer_name,
         a.id as area_id,
         a.name as area_name
  from public.customers c
  left join public.sites s on s.customer_id = c.id
  left join public.areas a on a.site_id = s.id
  where exists (
    select 1 from public.admins ad
    where ad.id = p_admin_id and p_admin_id = auth.uid() and ad.is_active = true
  )
  order by c.name asc nulls last, a.name asc nulls last;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_customer_managers(p_admin_id uuid, p_customer_id uuid)
 RETURNS TABLE(manager_id uuid, first_name text, last_name text, role text, mobile_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select m.id, m.first_name, m.last_name, m.role, m.mobile_number
  from public.manager_customers mc
  join public.managers m on m.id = mc.manager_id
  where mc.customer_id = p_customer_id
    and coalesce(m.is_active, true) = true
  order by m.first_name, m.last_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_customers(p_admin_id uuid)
 RETURNS SETOF uk_customers
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.*
  from public.uk_customers c
  where exists (
      select 1 from public.admins a
      where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true
    )
  order by coalesce(c.display_name, c.name) asc nulls last;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_managers(p_admin_id uuid)
 RETURNS TABLE(id uuid, first_name text, last_name text, role text, mobile_number text, username text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select m.id, m.first_name, m.last_name, m.role, m.mobile_number, m.username
  from public.managers m
  where coalesce(m.is_active, true) = true
  order by m.first_name, m.last_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_presets(p_admin_id uuid)
 RETURNS SETOF area_presets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then raise exception 'not authorized' using errcode = '42501'; end if;
  return query select * from public.area_presets order by name;
end; $function$;

CREATE OR REPLACE FUNCTION public.admin_list_user_customer_links(p_admin_id uuid)
 RETURNS TABLE(role text, user_id uuid, customer_id uuid, customer_label text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select coalesce(m.role, 'manager')::text,
           mc.manager_id,
           mc.customer_id,
           coalesce(nullif(btrim(c.display_name::text), ''), c.name)::text
    from public.manager_customers mc
    join public.managers m on m.id = mc.manager_id
    join public.uk_customers c on c.id = mc.customer_id
    union all
    select 'cleaner'::text,
           cc.cleaner_id,
           cc.customer_id,
           coalesce(nullif(btrim(c.display_name::text), ''), c.name)::text
    from public.cleaner_customers cc
    join public.cleaners cl on cl.id = cc.cleaner_id
    join public.uk_customers c on c.id = cc.customer_id
    order by 4, 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_rename_customer(p_admin_id uuid, p_old_name text, p_new_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin boolean;
  v_new text := trim(p_new_name);
  v_old text := trim(p_old_name);
  v_cust record;
  v_match_count int;
  v_old_names text[];
  v_pairs text[] := array[
    'area_tasks.customer_name',
    'bathroom_assist_requests.customer_name',
    'building_qr_codes.customer_name',
    'building_toilet_stats.customer_name',
    'cleaner_logs.customer_name',
    'cleaner_tasks.customer_name',
    'customer_feedback.customer_name',
    'messages.customer_name',
    'ops_site_visits.customer_name',
    'staff_activity.customer_name',
    'time_attendance.customer_name',
    'toilet_events.customer_name',
    'uk_operations_manager_logs.customer_name',
    'uk_operations_manager_visit_photos.customer_name',
    'uk_operations_manager_visit_photos.customer',
    'uk_operations_managers_visits.customer_name'
  ];
  v_pair text;
  v_tbl text;
  v_col text;
  v_n bigint;
  v_counts jsonb := '{}'::jsonb;
begin
  if v_new is null or v_new = '' then
    raise exception 'new name required' using errcode = '23514';
  end if;

  select exists (
    select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true
  ) into v_is_admin;
  if not v_is_admin then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Resolve the client by current canonical name or display name (active only).
  select count(*) into v_match_count
  from public.uk_customers u
  where u.is_active = true
    and (lower(coalesce(u.display_name, u.name)) = lower(v_old) or lower(u.name) = lower(v_old));

  if v_match_count = 0 then
    raise exception 'no active client matches "%"', v_old using errcode = 'P0002';
  end if;
  if v_match_count > 1 then
    raise exception 'several active clients match "%": rename is ambiguous', v_old using errcode = 'P0003';
  end if;

  select u.id, u.name, u.display_name into v_cust
  from public.uk_customers u
  where u.is_active = true
    and (lower(coalesce(u.display_name, u.name)) = lower(v_old) or lower(u.name) = lower(v_old))
  limit 1;

  -- All existing string variants denormalized rows may have been stamped with.
  v_old_names := array(
    select distinct x from unnest(array[v_cust.name, v_cust.display_name]) x
    where x is not null and x <> ''
  );

  -- Canonical record.
  update public.uk_customers
     set name = v_new, display_name = v_new, customer_name = v_new, updated_at = now()
   where id = v_cust.id;

  -- Relational customers row (name is UNIQUE — fall back to a suffixed name on collision).
  begin
    update public.customers set name = v_new where id = v_cust.id;
  exception when unique_violation then
    update public.customers
       set name = v_new || ' [' || left(v_cust.id::text, 8) || ']'
     where id = v_cust.id;
  end;

  -- Denormalized customer-name columns across the operational tables.
  foreach v_pair in array v_pairs loop
    v_tbl := split_part(v_pair, '.', 1);
    v_col := split_part(v_pair, '.', 2);
    execute format('update public.%I set %I = $1 where %I = any($2)', v_tbl, v_col, v_col)
      using v_new, v_old_names;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(v_pair, v_n);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'customer_id', v_cust.id,
    'old_name', v_cust.name,
    'new_name', v_new,
    'updated', v_counts
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_rename_user(p_admin_id uuid, p_role text, p_user_id uuid, p_first_name text, p_last_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_is_admin boolean; v_first text := trim(coalesce(p_first_name, '')); v_last text := trim(coalesce(p_last_name, ''));
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_first = '' then raise exception 'first name required' using errcode = '23514'; end if;
  if p_role = 'cleaner' then
    update public.cleaners set first_name = v_first, last_name = v_last, updated_at = now() where id = p_user_id;
  elsif p_role in ('manager','ops_manager') then
    update public.managers set first_name = v_first, last_name = v_last, updated_at = now() where id = p_user_id;
  elsif p_role = 'admin' then
    update public.admins set first_name = v_first, last_name = v_last, updated_at = now() where id = p_user_id;
  else
    raise exception 'invalid role' using errcode = '22023';
  end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.admin_seed_area_tasks(p_admin_id uuid, p_customer_name text, p_area_name text, p_area_type text, p_tasks text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin boolean;
  v_inserted integer := 0;
  v_task text;
  v_sort integer := 0;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  foreach v_task in array p_tasks loop
    insert into public.area_tasks (customer_name, area, task_description, task_type, active, sort_order)
    values (p_customer_name, p_area_name, v_task, p_area_type, true, v_sort)
    on conflict do nothing;
    v_inserted := v_inserted + 1;
    v_sort := v_sort + 1;
  end loop;

  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_soft_delete_customer(p_admin_id uuid, p_customer_id uuid)
 RETURNS uk_customers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.uk_customers%rowtype;
  v_ok boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active) into v_ok;
  if not v_ok then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.uk_customers
  set is_active = false, updated_at = now()
  where id = p_customer_id
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_soft_delete_customer_by_name(p_admin_id uuid, p_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ok boolean;
  v_name text := trim(p_name);
  v_count int := 0;
begin
  if v_name is null or v_name = '' then
    raise exception 'name required' using errcode = '23514';
  end if;

  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active) into v_ok;
  if not v_ok then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Try customers first
  update public.customers
  set is_active = false, updated_at = now()
  where lower(name) = lower(v_name) and coalesce(is_active, true) is true;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  if v_count = 0 then
    -- Fallback to uk_customers
    update public.uk_customers
    set is_active = false, updated_at = now()
    where lower(coalesce(display_name, name)) = lower(v_name) and coalesce(is_active, true) is true;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  end if;

  return case when v_count > 0 then 'ok' else 'not_found' end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_soft_delete_customer_cascade(p_admin_id uuid, p_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
  v_admin_active boolean;
begin
  select is_active into v_admin_active from public.admins where id = p_admin_id and p_admin_id = auth.uid();
  if coalesce(v_admin_active, false) is false then
    raise exception 'admin not active' using errcode = '42501';
  end if;

  select name into v_name from public.customers where id = p_customer_id;
  update public.customers set is_active = false, updated_at = now() where id = p_customer_id;

  update public.area_tasks
     set active = false, updated_at = now()
   where customer_name is not null
     and lower(customer_name) = lower(coalesce(v_name, ''));

  update public.building_qr_codes
     set is_active = false, deactivated_at = now()
   where customer_name is not null
     and lower(customer_name) = lower(coalesce(v_name, ''));
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_unassign_cleaner_from_customer(p_admin_id uuid, p_cleaner_id uuid, p_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from public.cleaner_customers
  where cleaner_id = p_cleaner_id and customer_id = p_customer_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_unassign_manager_from_customer(p_admin_id uuid, p_manager_id uuid, p_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from public.manager_customers
  where manager_id = p_manager_id and customer_id = p_customer_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_customer_details(p_admin_id uuid, p_customer_id uuid, p_display_name text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text)
 RETURNS uk_customers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.uk_customers%rowtype;
  v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.uk_customers
    set display_name  = coalesce(nullif(trim(p_display_name), ''), display_name),
        address       = coalesce(nullif(trim(p_address), ''), address),
        contact_email = coalesce(nullif(trim(p_contact_email), ''), contact_email),
        contact_phone = coalesce(nullif(trim(p_contact_phone), ''), contact_phone),
        updated_at    = now()
    where id = p_customer_id
    returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_preset(p_admin_id uuid, p_preset_id uuid, p_name text, p_items jsonb)
 RETURNS area_presets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_is_admin boolean; v_row public.area_presets%rowtype;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and p_admin_id = auth.uid() and a.is_active = true) into v_is_admin;
  if not v_is_admin then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.area_presets
    set name = coalesce(nullif(trim(p_name), ''), name),
        items = coalesce(p_items, items),
        updated_at = now()
    where id = p_preset_id
    returning * into v_row;
  return v_row;
end; $function$;

commit;
