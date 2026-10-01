-- MCC Timecards production workflow and security hardening.
insert into public.organizations (id,name,timezone)
values ('00000000-0000-0000-0000-000000000001','McMinnville Covenant Church','America/Los_Angeles')
on conflict (id) do nothing;

insert into public.organization_settings (organization_id,certification_text)
values ('00000000-0000-0000-0000-000000000001','I certify that this timecard accurately reflects the hours I have worked and, where applicable, the hours I anticipate working for the remainder of today''s scheduled work period. I understand that I should report any difference between anticipated and actual hours.')
on conflict (organization_id) do nothing;

alter table public.profiles add column if not exists must_change_password boolean not null default true;

-- API access is still constrained by the row-level policies below.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create or replace function public.user_app_role() returns public.app_role
language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() and active $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public
as $$ begin
  insert into public.profiles(id,organization_id,display_name,role)
  values(new.id,'00000000-0000-0000-0000-000000000001',coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)),'employee')
  on conflict(id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.organization_settings enable row level security;
alter table public.supervisor_assignments enable row level security;
alter table public.employee_certifications enable row level security;
alter table public.supervisor_approvals enable row level security;
alter table public.amendments enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists cards_employee_create on public.monthly_timecards;
create policy cards_employee_create on public.monthly_timecards for insert with check(employee_id=auth.uid());
drop policy if exists cards_employee_update on public.monthly_timecards;
create policy cards_employee_update on public.monthly_timecards for update using(employee_id=auth.uid() and status in ('draft','returned')) with check(employee_id=auth.uid());
drop policy if exists cards_supervisor_update on public.monthly_timecards;
create policy cards_supervisor_update on public.monthly_timecards for update using(status='submitted' and exists(select 1 from public.supervisor_assignments s where s.employee_id=monthly_timecards.employee_id and s.supervisor_id=auth.uid() and s.active)) with check(status in ('returned','approved'));
drop policy if exists versions_employee_create on public.timecard_versions;
create policy versions_employee_create on public.timecard_versions for insert with check(exists(select 1 from public.monthly_timecards m where m.id=timecard_id and m.employee_id=auth.uid() and m.status in ('draft','returned')));
drop policy if exists certifications_employee_create on public.employee_certifications;
create policy certifications_employee_create on public.employee_certifications for insert with check(employee_id=auth.uid());
drop policy if exists approvals_supervisor_create on public.supervisor_approvals;
create policy approvals_supervisor_create on public.supervisor_approvals for insert with check(supervisor_id=auth.uid() and exists(select 1 from public.timecard_versions v join public.monthly_timecards m on m.id=v.timecard_id join public.supervisor_assignments s on s.employee_id=m.employee_id where v.id=timecard_version_id and s.supervisor_id=auth.uid() and s.active));
drop policy if exists settings_read on public.organization_settings;
create policy settings_read on public.organization_settings for select using(organization_id=(select organization_id from public.profiles where id=auth.uid()));
drop policy if exists assignments_read on public.supervisor_assignments;
create policy assignments_read on public.supervisor_assignments for select using(employee_id=auth.uid() or supervisor_id=auth.uid() or public.user_app_role()='admin');
drop policy if exists certifications_read on public.employee_certifications;
create policy certifications_read on public.employee_certifications for select using(employee_id=auth.uid() or public.user_app_role()='admin' or exists(select 1 from public.supervisor_assignments s where s.employee_id=employee_certifications.employee_id and s.supervisor_id=auth.uid() and s.active));
drop policy if exists approvals_read on public.supervisor_approvals;
create policy approvals_read on public.supervisor_approvals for select using(supervisor_id=auth.uid() or public.user_app_role()='admin' or exists(select 1 from public.timecard_versions v join public.monthly_timecards m on m.id=v.timecard_id where v.id=timecard_version_id and m.employee_id=auth.uid()));
drop policy if exists amendments_read on public.amendments;
create policy amendments_read on public.amendments for select using(requested_by=auth.uid() or public.user_app_role()='admin');
drop policy if exists audit_admin_read on public.audit_events;
create policy audit_admin_read on public.audit_events for select using(public.user_app_role()='admin');

create or replace function public.prevent_approved_entry_change() returns trigger
language plpgsql set search_path=public as $$ begin
  if exists(select 1 from public.monthly_timecards where id=coalesce(old.timecard_id,new.timecard_id) and status='approved') then
    raise exception 'Approved timecard entries are immutable; create an amendment';
  end if;
  return coalesce(new,old);
end $$;
drop trigger if exists protect_approved_entries on public.time_entries;
create trigger protect_approved_entries before update or delete on public.time_entries for each row execute function public.prevent_approved_entry_change();
