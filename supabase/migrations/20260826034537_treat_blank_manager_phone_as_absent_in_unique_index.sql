-- Harden the previous migration: the partial index exempted NULL but not '',
-- so any caller still writing the old empty-string sentinel would reintroduce
-- the collision. Treat blank and NULL identically as "no phone".

drop index if exists public.managers_mobile_number_unique_idx;

create unique index managers_mobile_number_unique_idx
  on public.managers (mobile_number)
  where coalesce(mobile_number, '') <> '';

comment on index public.managers_mobile_number_unique_idx is
  'One account per real phone number. Username-identified roles (ops_manager, admin) store NULL/blank and are exempt.';
