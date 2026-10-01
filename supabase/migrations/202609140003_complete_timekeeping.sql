-- Complete punch, correction, pay-period, and review workflow.
alter table public.organization_settings
  add column if not exists pay_period_type text not null default 'monthly'
    check (pay_period_type in ('weekly','biweekly','semimonthly','monthly'));

alter table public.monthly_timecards
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id),
  add column if not exists returned_at timestamptz,
  add column if not exists return_reason text;

create table if not exists public.work_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  employee_id uuid not null references public.profiles(id),
  timecard_id uuid not null references public.monthly_timecards(id),
  started_at timestamptz not null,
  ended_at timestamptz,
  break_minutes integer not null default 0 check (break_minutes between 0 and 1440),
  source text not null default 'clock' check (source in ('clock','manual')),
  correction_reason text,
  corrected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at),
  check (source = 'clock' or length(trim(correction_reason)) >= 3)
);
create index if not exists work_shifts_employee_started_idx on public.work_shifts(employee_id,started_at desc);
create unique index if not exists one_open_shift_per_employee on public.work_shifts(employee_id) where ended_at is null;

alter table public.work_shifts enable row level security;
grant select,insert,update,delete on public.work_shifts to authenticated;

drop policy if exists shifts_authorized_read on public.work_shifts;
create policy shifts_authorized_read on public.work_shifts for select using (
  employee_id=auth.uid() or public.user_app_role()='admin' or exists (
    select 1 from public.supervisor_assignments a
    where a.employee_id=work_shifts.employee_id and a.supervisor_id=auth.uid() and a.active
  )
);
drop policy if exists shifts_employee_insert on public.work_shifts;
create policy shifts_employee_insert on public.work_shifts for insert with check (
  employee_id=auth.uid() and exists (
    select 1 from public.monthly_timecards c where c.id=timecard_id and c.employee_id=auth.uid() and c.status in ('draft','returned')
  )
);
drop policy if exists shifts_employee_update on public.work_shifts;
create policy shifts_employee_update on public.work_shifts for update using (
  employee_id=auth.uid() and exists (
    select 1 from public.monthly_timecards c where c.id=timecard_id and c.employee_id=auth.uid() and c.status in ('draft','returned')
  )
) with check (employee_id=auth.uid());
drop policy if exists shifts_admin_update on public.work_shifts;
create policy shifts_admin_update on public.work_shifts for update using (public.user_app_role()='admin');

drop policy if exists profiles_self_or_admin on public.profiles;
create policy profiles_self_or_admin on public.profiles for select using (
  id=auth.uid() or public.user_app_role()='admin' or exists (
    select 1 from public.supervisor_assignments a where a.supervisor_id=auth.uid() and a.employee_id=profiles.id and a.active
  )
);
drop policy if exists assignments_admin_write on public.supervisor_assignments;
create policy assignments_admin_write on public.supervisor_assignments for all
  using (public.user_app_role()='admin') with check (public.user_app_role()='admin');
drop policy if exists settings_admin_write on public.organization_settings;
create policy settings_admin_write on public.organization_settings for update
  using (public.user_app_role()='admin') with check (public.user_app_role()='admin');
drop policy if exists cards_admin_update on public.monthly_timecards;
create policy cards_admin_update on public.monthly_timecards for update
  using (public.user_app_role()='admin') with check (public.user_app_role()='admin');

create or replace function public.ensure_month_card(p_employee uuid, p_at timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_month date; v_id uuid;
begin
  if p_employee <> auth.uid() then raise exception 'Not authorized'; end if;
  select organization_id into v_org from profiles where id=p_employee and active;
  v_month := date_trunc('month', p_at at time zone 'America/Los_Angeles')::date;
  insert into monthly_timecards(organization_id,employee_id,month)
  values(v_org,p_employee,v_month)
  on conflict(employee_id,month) do nothing;
  select id into v_id from monthly_timecards where employee_id=p_employee and month=v_month;
  return v_id;
end $$;

create or replace function public.clock_in()
returns public.work_shifts language plpgsql security definer set search_path=public as $$
declare v_card uuid; v_org uuid; v_shift work_shifts;
begin
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  if exists(select 1 from work_shifts where employee_id=auth.uid() and ended_at is null) then raise exception 'You are already clocked in'; end if;
  v_card := ensure_month_card(auth.uid(),now());
  if exists(select 1 from monthly_timecards where id=v_card and status not in ('draft','returned')) then raise exception 'This timecard is locked'; end if;
  select organization_id into v_org from profiles where id=auth.uid();
  insert into work_shifts(organization_id,employee_id,timecard_id,started_at)
  values(v_org,auth.uid(),v_card,now()) returning * into v_shift;
  insert into audit_events(organization_id,actor_id,subject_id,action,after_value)
  values(v_org,auth.uid(),v_shift.id,'clock_in',to_jsonb(v_shift));
  return v_shift;
end $$;

create or replace function public.clock_out()
returns public.work_shifts language plpgsql security definer set search_path=public as $$
declare v_shift work_shifts;
begin
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  select * into v_shift from work_shifts where employee_id=auth.uid() and ended_at is null for update;
  if v_shift.id is null then raise exception 'You are not clocked in'; end if;
  update work_shifts set ended_at=now(),updated_at=now() where id=v_shift.id returning * into v_shift;
  insert into audit_events(organization_id,actor_id,subject_id,action,after_value)
  values(v_shift.organization_id,auth.uid(),v_shift.id,'clock_out',to_jsonb(v_shift));
  return v_shift;
end $$;

grant execute on function public.ensure_month_card(uuid,timestamptz) to authenticated;
grant execute on function public.clock_in() to authenticated;
grant execute on function public.clock_out() to authenticated;

create or replace function public.audit_shift_change() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.started_at is distinct from new.started_at or (old.ended_at is not null and old.ended_at is distinct from new.ended_at) or old.break_minutes is distinct from new.break_minutes then
    if coalesce(length(trim(new.correction_reason)),0) < 3 then raise exception 'Reason for correction is required'; end if;
    new.corrected := true; new.updated_at := now();
    insert into audit_events(organization_id,actor_id,subject_id,action,before_value,after_value)
    values(new.organization_id,auth.uid(),new.id,'shift_corrected',to_jsonb(old),to_jsonb(new));
  end if;
  return new;
end $$;
drop trigger if exists audit_work_shift_change on public.work_shifts;
create trigger audit_work_shift_change before update on public.work_shifts for each row execute function public.audit_shift_change();

create or replace function public.prevent_shift_overlap() returns trigger
language plpgsql set search_path=public as $$
begin
  if exists(select 1 from work_shifts s where s.employee_id=new.employee_id and s.id<>new.id and tstzrange(s.started_at,coalesce(s.ended_at,'infinity')) && tstzrange(new.started_at,coalesce(new.ended_at,'infinity'))) then
    raise exception 'This shift overlaps an existing shift';
  end if;
  return new;
end $$;
drop trigger if exists prevent_work_shift_overlap on public.work_shifts;
create trigger prevent_work_shift_overlap before insert or update on public.work_shifts for each row execute function public.prevent_shift_overlap();
