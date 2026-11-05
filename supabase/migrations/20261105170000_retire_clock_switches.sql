-- Retire the clock kill switches.
--
-- clock_v2 and scanner_v2 (app_config, added in 20261105090000) let an admin
-- send phones back to the old clock or the old camera. P6 deleted both old
-- paths from the app, and since P6 no client reads these rows: turning one
-- off would do nothing. Delete them so nobody flips a switch that isn't wired.
-- The app_config table stays (empty) for future settings.
--
-- Rollback (only useful with a pre-P6 client):
--   insert into public.app_config (key, value) values ('clock_v2', 'true'::jsonb), ('scanner_v2', 'true'::jsonb);

begin;

delete from public.app_config where key in ('clock_v2', 'scanner_v2');

commit;
