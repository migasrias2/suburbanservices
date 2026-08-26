-- "Reasonable notice" will be pinned down by secondary legislation; 48 hours is
-- the working assumption until then, and is a single number to change here.
create or replace function public.short_notice_threshold_hours()
returns numeric language sql immutable as $$ select 48::numeric $$;

create or replace view public.cleaner_shift_notice_log
with (security_invoker = true) as
select
  c.id,
  c.shift_id,
  c.cleaner_id,
  cl.first_name || ' ' || cl.last_name as cleaner_name,
  c.change_type,
  c.changed_at,
  c.changed_by,
  c.notice_hours,
  c.previous_start,
  c.new_start,
  c.detail,
  -- only changes that take work away from someone can attract compensation
  (c.change_type in ('cancelled', 'rescheduled')
    and c.notice_hours is not null
    and c.notice_hours < public.short_notice_threshold_hours()
    and c.notice_hours > -24) as is_short_notice
from public.cleaner_shift_changes c
left join public.cleaners cl on cl.id = c.cleaner_id;

grant select on public.cleaner_shift_notice_log to authenticated;
