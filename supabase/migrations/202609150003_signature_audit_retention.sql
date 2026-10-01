create or replace function public.audit_timecard_status_change() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.status is distinct from new.status then
    insert into public.audit_events(organization_id,actor_id,subject_id,action,before_value,after_value)
    values(new.organization_id,auth.uid(),new.id,'timecard_status_changed',to_jsonb(old),to_jsonb(new));
  end if;
  return new;
end $$;
drop trigger if exists audit_monthly_timecard_status on public.monthly_timecards;
create trigger audit_monthly_timecard_status after update of status on public.monthly_timecards
for each row execute function public.audit_timecard_status_change();
comment on table public.audit_events is 'MCC timecard audit history. Retain payroll-related records for at least three years.';
