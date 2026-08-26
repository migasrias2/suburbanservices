-- live_tracking was written and read with four columns that never existed on
-- the table: cleaner_name, customer_name, site_area and timestamp.
-- QRService.updateLiveTracking() therefore failed with a PostgREST 400 on
-- every scan (swallowed by a console.error), and ManagerDashboard's select of
-- those same columns failed too, so the live view has always been empty.

alter table public.live_tracking
  add column if not exists cleaner_name  text,
  add column if not exists customer_name text,
  add column if not exists site_area     text,
  add column if not exists "timestamp"   timestamptz;

-- Existing 622 rows came from the clock-event insert path, which only ever
-- wrote the columns that did exist. Give them a truthful event time rather
-- than letting a default stamp them all as "now".
update public.live_tracking
   set "timestamp" = coalesce(created_at, updated_at, now())
 where "timestamp" is null;

update public.live_tracking lt
   set cleaner_name = nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '')
  from public.cleaners c
 where c.id = lt.cleaner_id
   and lt.cleaner_name is null;

alter table public.live_tracking alter column "timestamp" set default now();
alter table public.live_tracking alter column "timestamp" set not null;
