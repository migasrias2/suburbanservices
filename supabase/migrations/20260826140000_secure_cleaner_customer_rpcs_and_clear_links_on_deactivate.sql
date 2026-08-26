-- Follow-up to 20260826120000_add_cleaner_customers_site_links.sql.
--
-- 1. That migration created three SECURITY DEFINER functions without any
--    GRANT/REVOKE. Postgres grants EXECUTE to PUBLIC on function creation, so
--    they may be executable by roles their siblings deliberately exclude
--    (`anon` was removed from `admin_executor` on 2026-07-02, but dropping a
--    role membership does not strip the default PUBLIC grant on functions
--    created afterwards). Rather than assert a specific ACL, this copies the
--    owner and grants that `admin_assign_manager_to_customer` actually carries
--    onto the three new functions, so they can never be weaker than the
--    sibling they were modelled on. If the reference is itself on Postgres
--    defaults, the ACL copy is a no-op and nothing is tightened.
--
-- 2. `cleaners.is_active` is a soft delete, so the FK cascade on
--    cleaner_customers never fires on deactivation and a deactivated cleaner
--    keeps appearing on their client's roster. Deactivating now drops the site
--    links, per the product decision of 2026-08-26. This is a trigger on the
--    is_active transition rather than an edit to admin_deactivate_user so that
--    every deactivation path is covered (that RPC, the Astra edge function,
--    and direct DB edits) and so that the RPC's existing body is not rewritten.

do $$
declare
  v_ref_owner name;
  v_ref_acl   aclitem[];
  v_tgt_acl   aclitem[];
  v_target    text;
  v_grantee   text;
  v_targets   text[] := array[
    'public.admin_assign_cleaner_to_customer(uuid,uuid,uuid)',
    'public.admin_unassign_cleaner_from_customer(uuid,uuid,uuid)',
    'public.admin_list_user_customer_links(uuid)'
  ];
  r record;
begin
  select pg_get_userbyid(p.proowner), p.proacl
    into v_ref_owner, v_ref_acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'admin_assign_manager_to_customer'
  order by p.oid
  limit 1;

  if v_ref_owner is null then
    raise exception
      'public.admin_assign_manager_to_customer not found; cannot mirror its privileges';
  end if;

  foreach v_target in array v_targets loop
    execute format('alter function %s owner to %I', v_target, v_ref_owner);

    -- A null proacl means the reference is on Postgres defaults (owner has
    -- everything, PUBLIC has EXECUTE). The new functions already match that,
    -- so there is nothing to mirror and nothing to tighten.
    continue when v_ref_acl is null;

    select p.proacl into v_tgt_acl
    from pg_proc p
    where p.oid = v_target::regprocedure;

    execute format('revoke all on function %s from public', v_target);

    if v_tgt_acl is not null then
      for r in select distinct grantee from aclexplode(v_tgt_acl) where grantee <> 0 loop
        execute format('revoke all on function %s from %I', v_target, pg_get_userbyid(r.grantee));
      end loop;
    end if;

    for r in select grantee, privilege_type, is_grantable from aclexplode(v_ref_acl) loop
      v_grantee := case
        when r.grantee = 0 then 'public'
        else quote_ident(pg_get_userbyid(r.grantee))
      end;
      execute format(
        'grant %s on function %s to %s%s',
        r.privilege_type,
        v_target,
        v_grantee,
        case when r.is_grantable then ' with grant option' else '' end
      );
    end loop;
  end loop;
end
$$;


create or replace function public.clear_cleaner_site_links_on_deactivate()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  delete from public.cleaner_customers
  where cleaner_id = new.id;

  return new;
end;
$function$;

drop trigger if exists cleaners_clear_site_links_on_deactivate on public.cleaners;
create trigger cleaners_clear_site_links_on_deactivate
  after update of is_active on public.cleaners
  for each row
  when (old.is_active is distinct from new.is_active and new.is_active is not true)
  execute function public.clear_cleaner_site_links_on_deactivate();
