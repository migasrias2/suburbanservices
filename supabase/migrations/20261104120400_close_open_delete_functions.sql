-- FLAREN-109 (MIG-5), migration 5. Found by the preflight run against the live
-- UK project on 2026-11-04.
--
-- Two SECURITY DEFINER functions owned by postgres let ANY signed-in user
-- (cleaner, client or manager) delete data, with no role check:
--
--   delete_old_cleaner_logs(p_batch int, p_days int)
--     deletes from uk_cleaner_logs, a view over cleaner_logs. Called with
--     p_days => 0 and a large batch it wipes every scan log.
--   delete_area_by_id(area_id uuid)
--     deletes any area.
--
-- Neither is called by the app, an Edge Function or a cron job. Execute stays
-- with postgres and service_role, so they can still be run from the SQL editor.
-- On the live database both were granted to authenticated directly (not via
-- admin_executor), so the revoke takes effect. The check at the end aborts
-- the migration if anon or authenticated can still execute either one.

do $$
declare
  r record;
  v_still_open text[] := '{}';
begin
  for r in
    select p.oid, p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('delete_old_cleaner_logs', 'delete_area_by_id')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);

    if has_function_privilege('anon', r.oid, 'EXECUTE')
       or has_function_privilege('authenticated', r.oid, 'EXECUTE') then
      v_still_open := v_still_open || r.sig::text;
    end if;
  end loop;

  if cardinality(v_still_open) > 0 then
    raise exception
      'anon/authenticated can still execute % (inherited from another role). Revoke it there first.',
      v_still_open;
  end if;
end
$$;
