-- Direct cleaner -> client/site assignment.
--
-- Until now a cleaner's site could only be inferred: manager_cleaners joined to
-- manager_customers, or a per-shift cleaner_shifts.customer_id, or string-matching
-- the customer name in cleaner_logs. That indirection is why only 4 of 28 cleaners
-- resolved to a client at all. This table mirrors manager_customers so both roles
-- answer "which sites is this person on?" the same way.

create table if not exists public.cleaner_customers (
  cleaner_id  uuid not null references public.cleaners(id)     on delete cascade,
  customer_id uuid not null references public.uk_customers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (cleaner_id, customer_id)
);

create index if not exists cleaner_customers_customer_id_idx
  on public.cleaner_customers (customer_id);

alter table public.cleaner_customers enable row level security;

-- Managers scope their dashboard rosters off this table from the browser, so reads
-- are open to any authenticated session (public.cleaners already reads the same way).
-- There is deliberately no write policy: every write goes through the SECURITY
-- DEFINER admin RPCs below, matching how manager_customers is handled.
drop policy if exists cleaner_customers_read on public.cleaner_customers;
create policy cleaner_customers_read
  on public.cleaner_customers
  for select
  to authenticated
  using (true);

-- Seed from the manager_cleaners -> manager_customers indirection being replaced.
insert into public.cleaner_customers (cleaner_id, customer_id)
select distinct mcl.cleaner_id, mc.customer_id
from public.manager_cleaners mcl
join public.manager_customers mc on mc.manager_id = mcl.manager_id
on conflict do nothing;


create or replace function public.admin_assign_cleaner_to_customer(
  p_admin_id uuid,
  p_cleaner_id uuid,
  p_customer_id uuid
)
returns public.cleaner_customers
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.cleaner_customers%rowtype;
  v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and a.is_active = true) into v_is_admin;
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


create or replace function public.admin_unassign_cleaner_from_customer(
  p_admin_id uuid,
  p_cleaner_id uuid,
  p_customer_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and a.is_active = true) into v_is_admin;
  if not v_is_admin then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from public.cleaner_customers
  where cleaner_id = p_cleaner_id and customer_id = p_customer_id;
end;
$function$;


-- One call hydrates every site link on the users page, for both roles.
create or replace function public.admin_list_user_customer_links(p_admin_id uuid)
returns table(role text, user_id uuid, customer_id uuid, customer_label text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_admin boolean;
begin
  select exists (select 1 from public.admins a where a.id = p_admin_id and a.is_active = true) into v_is_admin;
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
