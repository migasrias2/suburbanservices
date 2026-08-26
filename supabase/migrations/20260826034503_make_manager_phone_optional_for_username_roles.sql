-- Ops managers and admins identify by username, not by phone. Because
-- managers.mobile_number was NOT NULL, the admin-create-user Edge Function
-- wrote '' for those roles, and the UNIQUE constraint then allowed exactly
-- one such account to exist. The first ops_manager took the '' slot; every
-- later one failed with 23505 and the function returned 400, surfacing in the
-- UI as "Could not create user".
--
-- Phone becomes optional. NULL is the "no phone" value, and uniqueness is
-- preserved for real numbers only via a partial index, so any number of
-- username-identified accounts can coexist.

alter table public.managers alter column mobile_number drop not null;

-- Collapse the sentinel empty strings onto the new NULL representation.
update public.managers
   set mobile_number = null,
       updated_at    = now()
 where coalesce(mobile_number, '') = '';

alter table public.managers drop constraint if exists managers_mobile_number_key;

create unique index if not exists managers_mobile_number_unique_idx
  on public.managers (mobile_number)
  where mobile_number is not null;

comment on index public.managers_mobile_number_unique_idx is
  'One account per real phone number. Username-identified roles (ops_manager, admin) store NULL and are exempt.';
