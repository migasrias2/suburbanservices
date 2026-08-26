-- Canonical phone normalisation, mirroring src/lib/authHelpers.ts
-- normalizePhoneToDigits(). The two MUST stay in sync: this value is the
-- local part of the synthetic Supabase Auth email, i.e. the account identity.
--
-- Background: cleaners/managers already carry a UNIQUE constraint on
-- mobile_number, but it compares the raw string. "07586276920",
-- "+4407586276920" and "+440447591322658" are three different strings and one
-- phone, so the constraint never fired and the same person got several
-- accounts, each with its own login and its own slice of history.
create or replace function public.normalize_phone_digits(phone text)
returns text
language plpgsql
immutable
as $$
declare
  d text;
begin
  d := regexp_replace(coalesce(phone, ''), '\D', '', 'g');
  if d = '' then
    return '';
  end if;

  if left(d, 2) = '00' then                    -- 0044... -> 44...
    d := substr(d, 3);
  end if;

  if left(d, 1) = '0' then                     -- 07...   -> 447...
    d := '44' || substr(d, 2);
  end if;

  if d ~ '^7\d{9}$' then                       -- 7xxxxxxxxx -> 447xxxxxxxxx
    d := '44' || d;
  end if;

  -- Peel prefixes left behind by a UI that blindly prepends "+44".
  -- Only while longer than a UK number, so a valid number is never truncated.
  for i in 1..4 loop
    exit when length(d) <= 12;
    if left(d, 3) = '440' then
      d := '44' || substr(d, 4);
    elsif left(d, 4) = '4444' then
      d := substr(d, 3);
    else
      exit;
    end if;
  end loop;

  return d;
end;
$$;

comment on function public.normalize_phone_digits(text) is
  'Canonical phone identity. Mirrors normalizePhoneToDigits() in src/lib/authHelpers.ts - keep both in sync.';

-- Store every number in one shape: E.164.
-- Rows belonging to a pre-existing duplicate group are skipped: collapsing
-- them would collide on cleaners_mobile_number_key, and picking a survivor is
-- a human decision (see the phone_account_duplicates view below).
update public.cleaners c
   set mobile_number = '+' || public.normalize_phone_digits(c.mobile_number),
       updated_at    = now()
 where coalesce(c.mobile_number, '') <> ''
   and c.mobile_number is distinct from '+' || public.normalize_phone_digits(c.mobile_number)
   and (select count(*) from public.cleaners c2
         where public.normalize_phone_digits(c2.mobile_number)
             = public.normalize_phone_digits(c.mobile_number)) = 1;

update public.managers m
   set mobile_number = '+' || public.normalize_phone_digits(m.mobile_number),
       updated_at    = now()
 where coalesce(m.mobile_number, '') <> ''
   and m.mobile_number is distinct from '+' || public.normalize_phone_digits(m.mobile_number)
   and (select count(*) from public.managers m2
         where public.normalize_phone_digits(m2.mobile_number)
             = public.normalize_phone_digits(m.mobile_number)) = 1;

create index if not exists cleaners_normalized_phone_idx on public.cleaners (public.normalize_phone_digits(mobile_number));
create index if not exists managers_normalized_phone_idx on public.managers (public.normalize_phone_digits(mobile_number));

-- Guard: refuse to create a second account for a phone that already has one.
-- Scoped to inserts and to updates that actually change the number, so the
-- pre-existing duplicate pairs stay editable until they are merged by hand.
create or replace function public.prevent_duplicate_phone_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  norm  text;
  clash uuid;
begin
  norm := public.normalize_phone_digits(new.mobile_number);
  if norm = '' then
    return new;
  end if;

  if tg_op = 'UPDATE' and public.normalize_phone_digits(old.mobile_number) = norm then
    return new;                                  -- number unchanged, nothing to check
  end if;

  execute format(
    'select id from public.%I where id <> $1 and public.normalize_phone_digits(mobile_number) = $2 limit 1',
    tg_table_name
  ) into clash using new.id, norm;

  if clash is not null then
    raise exception 'An account already exists for phone +% (%.id = %)', norm, tg_table_name, clash
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists cleaners_prevent_duplicate_phone on public.cleaners;
create trigger cleaners_prevent_duplicate_phone
  before insert or update of mobile_number on public.cleaners
  for each row execute function public.prevent_duplicate_phone_account();

drop trigger if exists managers_prevent_duplicate_phone on public.managers;
create trigger managers_prevent_duplicate_phone
  before insert or update of mobile_number on public.managers
  for each row execute function public.prevent_duplicate_phone_account();

-- Standing report of accounts that are one phone but several records.
create or replace view public.phone_account_duplicates as
select 'cleaners' as source_table, public.normalize_phone_digits(mobile_number) as normalized_phone,
       count(*) as account_count, array_agg(id order by created_at) as ids,
       array_agg(trim(first_name || ' ' || last_name) order by created_at) as names,
       array_agg(mobile_number order by created_at) as stored_numbers,
       array_agg(is_active order by created_at) as active_flags
  from public.cleaners
 where coalesce(mobile_number, '') <> ''
 group by 1, 2 having count(*) > 1
union all
select 'managers', public.normalize_phone_digits(mobile_number),
       count(*), array_agg(id order by created_at),
       array_agg(trim(first_name || ' ' || last_name) order by created_at),
       array_agg(mobile_number order by created_at),
       array_agg(is_active order by created_at)
  from public.managers
 where coalesce(mobile_number, '') <> ''
 group by 1, 2 having count(*) > 1;

comment on view public.phone_account_duplicates is
  'Accounts sharing one real phone number across differing stored formats.';
