-- FLAREN-109, part 2 of 3. App logins cannot delete staff records.
--
-- Client request (2026-11-04): a client or manager login must not be able to
-- delete staff records. Two layers, because neither is enough alone:
--
-- 1. REVOKE DELETE and TRUNCATE on the staff tables from public, anon and
--    authenticated. The browser never deletes from these tables: the app's only
--    direct deletes are cleaner_shifts (admin weekly schedule), area_tasks,
--    ops_site_visits and manager_photo_feedback (a manager's own thumbs-up), none
--    of which are in the revoke list. Admin site-link changes go through SECURITY
--    DEFINER RPCs, and edge functions use the service role; neither depends on
--    these grants.
--
-- 2. A RESTRICTIVE delete policy on each of those tables (and on cleaner_shifts):
--    only an admin, by table membership via has_app_role, may delete. A
--    restrictive policy is ANDed with whatever permissive policies already exist
--    in the live database, so it can only narrow access, never widen it. It
--    matters because `authenticated` is a member of `admin_executor`: if that
--    role holds DELETE on a table, the REVOKE above does not take effect.
--    The policy covers that case wherever RLS is on.
--
-- Defensive about unknown live state:
--   * missing tables and views are skipped with a NOTICE;
--   * RLS is never switched on here (that could lock out every read). A table
--     without RLS gets the REVOKE only;
--   * if any SECURITY INVOKER function or trigger function deletes from (or
--     truncates) one of these tables, the migration ABORTS before changing
--     anything and names it. Such a function runs with the caller's rights, so
--     after this migration its delete would fail or, worse, silently remove 0
--     rows (e.g. a clock-out trigger clearing live_tracking). A human decides:
--     make it SECURITY DEFINER, or drop the table from this list. Preflight
--     section 6 lists the candidates;
--   * the final check aborts the whole migration if an app login could still
--     DELETE from a table and nothing stops it: RLS is off, or anon /
--     authenticated has the privileges of the table's owner (e.g. through
--     admin_executor) and the table is not FORCE ROW LEVEL SECURITY, so the
--     owner's RLS bypass applies to them.
--
-- Run scripts/2026-11-04-staff-delete-preflight.sql first (sections 3-6).

do $$
begin
  if to_regprocedure('public.has_app_role(text[])') is null then
    raise exception 'public.has_app_role(text[]) is missing; this migration relies on it';
  end if;
end
$$;

-- Abort before changing anything if a caller-rights function deletes from one
-- of the tables (B1, review 2026-11-04).
do $$
declare
  v_tables text[] := array[
    'cleaners', 'managers', 'admins',
    'time_attendance', 'cleaner_logs',
    'uk_cleaner_task_selections', 'uk_cleaner_task_photos',
    'manager_cleaners', 'manager_customers', 'cleaner_customers',
    'live_tracking', 'work_drafts', 'user_passwords',
    'cleaner_shift_changes', 'clock_event_failures', 'cleaner_shifts'
  ];
  v_table    text;
  v_found    text;
  v_offences text[] := '{}';
begin
  foreach v_table in array v_tables loop
    select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
      into v_found
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname not like 'pg\_%'
      and not p.prosecdef
      and p.prosrc ~* format(
        '(delete\s+from|truncate(\s+table)?)\s+(only\s+)?("?public"?\s*\.\s*)?"?%s"?([^a-z0-9_]|$)',
        v_table
      );

    if v_found is not null then
      v_offences := v_offences || format('%s <- %s', v_table, v_found);
    end if;
  end loop;

  if cardinality(v_offences) > 0 then
    raise exception
      'SECURITY INVOKER function(s) delete from staff tables: %. After this migration those deletes would fail or remove 0 rows. Make them SECURITY DEFINER or exclude the table, then re-run. Nothing was changed.',
      array_to_string(v_offences, '; ');
  end if;
end
$$;

do $$
declare
  -- Nothing in the app deletes from these as a signed-in user.
  v_revoke_tables text[] := array[
    'cleaners', 'managers', 'admins',
    'time_attendance', 'cleaner_logs',
    'uk_cleaner_task_selections', 'uk_cleaner_task_photos',
    'manager_cleaners', 'manager_customers', 'cleaner_customers',
    'live_tracking', 'work_drafts', 'user_passwords',
    'cleaner_shift_changes', 'clock_event_failures'
  ];
  -- Admins delete these from the browser (AdminWeeklySchedulePage); keep the
  -- grant, restrict the rows to admins.
  v_admin_delete_tables text[] := array['cleaner_shifts'];
  v_table     text;
  v_rel       regclass;
  v_relkind   "char";
  v_rls       boolean;
begin
  foreach v_table in array v_revoke_tables || v_admin_delete_tables loop
    v_rel := to_regclass(format('public.%I', v_table));
    if v_rel is null then
      raise notice 'public.% does not exist; skipped', v_table;
      continue;
    end if;

    select c.relkind, c.relrowsecurity into v_relkind, v_rls
    from pg_class c where c.oid = v_rel;

    if v_relkind not in ('r', 'p') then
      raise notice '% is not a table (relkind %); skipped', v_rel, v_relkind;
      continue;
    end if;

    -- TRUNCATE ignores RLS entirely, so it goes from every table on the list.
    execute format('revoke truncate on table %s from public, anon, authenticated', v_rel);

    if v_table = any (v_revoke_tables) then
      execute format('revoke delete on table %s from public, anon, authenticated', v_rel);
    end if;

    if v_rls then
      execute format('drop policy if exists %I on %s', 'staff_delete_admin_only', v_rel);
      execute format(
        'create policy %I on %s as restrictive for delete to anon, authenticated '
        'using ((select public.has_app_role(array[''admin''])))',
        'staff_delete_admin_only', v_rel
      );
      execute format(
        'comment on policy %I on %s is %L',
        'staff_delete_admin_only', v_rel,
        'FLAREN-109: only admins (by table membership) delete staff records. Restrictive, so it only narrows existing policies.'
      );
    else
      raise warning '% has RLS disabled; relying on the REVOKE alone', v_rel;
    end if;
  end loop;
end
$$;

-- Abort unless every table on the list is safe: either no app login can DELETE
-- (grants, including ones inherited through admin_executor), or RLS applies to
-- them so the admin-only policy does. RLS does not apply when it is off, or
-- when the login has the privileges of the table owner and RLS is not forced
-- (owners bypass it) -- B2, review 2026-11-04.
do $$
declare
  v_tables text[] := array[
    'cleaners', 'managers', 'admins',
    'time_attendance', 'cleaner_logs',
    'uk_cleaner_task_selections', 'uk_cleaner_task_photos',
    'manager_cleaners', 'manager_customers', 'cleaner_customers',
    'live_tracking', 'work_drafts', 'user_passwords',
    'cleaner_shift_changes', 'clock_event_failures', 'cleaner_shifts'
  ];
  v_unsafe   text[] := '{}';
  v_truncate text[] := '{}';
  r record;
begin
  for r in
    select
      c.oid::regclass as rel,
      c.relrowsecurity,
      c.relforcerowsecurity,
      pg_has_role('authenticated', c.relowner, 'USAGE') or pg_has_role('anon', c.relowner, 'USAGE') as login_is_owner
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname = any (v_tables)
  loop
    if (has_table_privilege('authenticated', r.rel, 'DELETE') or has_table_privilege('anon', r.rel, 'DELETE'))
       and (not r.relrowsecurity or (r.login_is_owner and not r.relforcerowsecurity)) then
      v_unsafe := v_unsafe || r.rel::text;
    end if;
    if has_table_privilege('authenticated', r.rel, 'TRUNCATE') or has_table_privilege('anon', r.rel, 'TRUNCATE') then
      v_truncate := v_truncate || r.rel::text;
    end if;
  end loop;

  if cardinality(v_truncate) > 0 then
    -- PostgREST cannot issue TRUNCATE, so this is a warning, not a failure.
    raise warning
      'anon/authenticated still hold TRUNCATE on % (inherited, e.g. via admin_executor). Revoke it from that role once its owners are known.',
      v_truncate;
  end if;

  if cardinality(v_unsafe) > 0 then
    raise exception
      'App logins can still DELETE from % and RLS does not apply to them there (RLS off, or they inherit the table owner and RLS is not forced). See preflight sections 3-4. Nothing was changed.',
      v_unsafe;
  end if;
end
$$;
