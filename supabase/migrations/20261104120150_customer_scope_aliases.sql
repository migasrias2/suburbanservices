-- FLAREN-109 (MIG-5), runs before migration 3 (20261104120200).
--
-- Migration 3 places rows at a client's site by whole-word matching the
-- client's name and display name. PSM Marine's QR codes and attendance rows
-- say "PSM" / "Psm", never "PSM Marine", so without this its client login
-- (James Spenceley) would lose every task row, photo and scan log.
--
-- Fix (Miguel, 2026-11-04, option A): a hidden list of extra names used ONLY
-- for site matching. Nothing in the app reads it, so no visible name changes.
-- Migration 3 exempts these from its 4-character rule but still runs its
-- clash checks on them. Preflight on the live database: "psm" as a whole word
-- matches only PSM's own data (16 QR codes, 33 attendance rows in 90 days).

alter table public.uk_customers
  add column if not exists scope_aliases text[] not null default '{}'::text[];

comment on column public.uk_customers.scope_aliases is
  'Extra names used only to match this client''s rows for client-login read scoping (migration 20261104120200). Not shown in the app.';

do $$
declare
  v_psm constant uuid := 'b1129836-e5d5-485d-a8b1-6ea4209c60c9';
begin
  update public.uk_customers
     set scope_aliases = array['PSM']
   where id = v_psm
     and not ('PSM' = any (scope_aliases));

  if not exists (select 1 from public.uk_customers where id = v_psm) then
    raise warning 'PSM Marine (%) not found; no scope alias set', v_psm;
  end if;
end
$$;
