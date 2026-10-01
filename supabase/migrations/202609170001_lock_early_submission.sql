-- Timecards may be signed and submitted only on or after the final calendar
-- day of their month, measured in MCC's Pacific Time zone.
create or replace function public.prevent_early_timecard_submission()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_last_day date := (date_trunc('month', new.month) + interval '1 month - 1 day')::date;
begin
  if new.status = 'submitted'
     and old.status is distinct from new.status
     and v_today < v_last_day then
    raise exception 'Timecard submission opens on %', to_char(v_last_day, 'FMMonth FMDD');
  end if;
  return new;
end
$$;

drop trigger if exists prevent_early_timecard_submission on public.monthly_timecards;
create trigger prevent_early_timecard_submission
before update of status on public.monthly_timecards
for each row execute function public.prevent_early_timecard_submission();
