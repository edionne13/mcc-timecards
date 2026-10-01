-- Keep work records internally consistent and make signing/review atomic.

create or replace function public.validate_work_shift()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_month date;
  v_status public.timecard_status;
  v_elapsed integer;
begin
  select month,status into v_month,v_status
  from public.monthly_timecards
  where id=new.timecard_id and employee_id=new.employee_id and organization_id=new.organization_id;

  if v_month is null then
    raise exception 'Time entry does not match its employee and monthly timecard';
  end if;
  if v_status not in ('draft','returned') then
    raise exception 'This timecard is locked';
  end if;
  if date_trunc('month',new.started_at at time zone 'America/Los_Angeles')::date <> v_month then
    raise exception 'Clock-in must be inside the selected timecard month';
  end if;
  if new.source='manual' and new.ended_at is not null
     and date_trunc('month',new.ended_at at time zone 'America/Los_Angeles')::date <> v_month then
    raise exception 'Clock-out must be inside the selected timecard month';
  end if;
  if new.source='manual' and (new.started_at > now()+interval '5 minutes' or new.ended_at > now()+interval '5 minutes') then
    raise exception 'Future time cannot be recorded as hours already worked';
  end if;
  if new.ended_at is not null then
    v_elapsed := round(extract(epoch from (new.ended_at-new.started_at))/60);
    if new.break_minutes > 0 and new.break_minutes >= v_elapsed then
      raise exception 'Unpaid break must be shorter than the full shift';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists validate_work_shift on public.work_shifts;
create trigger validate_work_shift
before insert or update on public.work_shifts
for each row execute function public.validate_work_shift();

create or replace function public.prevent_locked_shift_change()
returns trigger
language plpgsql
set search_path=public
as $$
declare v_card uuid := coalesce(old.timecard_id,new.timecard_id);
begin
  if exists(select 1 from public.monthly_timecards where id=v_card and status in ('submitted','approved')) then
    raise exception 'Submitted and approved time entries are locked';
  end if;
  return coalesce(new,old);
end
$$;

drop trigger if exists protect_locked_work_shifts on public.work_shifts;
create trigger protect_locked_work_shifts
before update or delete on public.work_shifts
for each row execute function public.prevent_locked_shift_change();

create or replace function public.submit_monthly_timecard(
  p_card uuid,
  p_signature text,
  p_snapshot jsonb
)
returns public.monthly_timecards
language plpgsql
security definer
set search_path=public
as $$
declare
  v_card public.monthly_timecards;
  v_profile public.profiles;
  v_version uuid;
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_last_day date;
begin
  select * into v_card from public.monthly_timecards where id=p_card for update;
  select * into v_profile from public.profiles where id=auth.uid() and active;
  if v_card.id is null or v_card.employee_id<>auth.uid() or v_card.status not in ('draft','returned') then
    raise exception 'This timecard cannot be submitted';
  end if;
  if lower(trim(coalesce(p_signature,'')))<>lower(trim(v_profile.display_name)) then
    raise exception 'Type your full name exactly to sign this timecard';
  end if;
  v_last_day := (date_trunc('month',v_card.month)+interval '1 month - 1 day')::date;
  if v_today<v_last_day then
    raise exception 'Timecard submission opens on %',to_char(v_last_day,'FMMonth FMDD');
  end if;
  if exists(select 1 from public.work_shifts where timecard_id=p_card and ended_at is null) then
    raise exception 'Clock out before submitting this timecard';
  end if;
  if not exists(select 1 from public.work_shifts where timecard_id=p_card) then
    raise exception 'Add at least one time entry before submitting';
  end if;

  insert into public.timecard_versions(timecard_id,version,snapshot,locked_at)
  values(p_card,v_card.current_version,p_snapshot,now())
  returning id into v_version;

  insert into public.employee_certifications(
    timecard_version_id,employee_id,display_name,typed_signature,
    certification_text,certification_version
  ) values(
    v_version,auth.uid(),v_profile.display_name,trim(p_signature),
    'I certify that the hours shown on this timecard are a true and accurate record of all hours I worked during this pay period. I have reviewed the time recorded, including meal periods and rest periods, and have reported any corrections or concerns to my supervisor. By selecting Sign & Submit, I intend to electronically sign this timecard and certify that the information provided is accurate to the best of my knowledge.',
    '3'
  );

  update public.monthly_timecards set
    status='submitted',submitted_at=now(),returned_at=null,return_reason=null
  where id=p_card returning * into v_card;
  return v_card;
end
$$;

create or replace function public.review_monthly_timecard(
  p_card uuid,
  p_action text,
  p_signature text default null,
  p_reason text default null
)
returns public.monthly_timecards
language plpgsql
security definer
set search_path=public
as $$
declare
  v_card public.monthly_timecards;
  v_profile public.profiles;
  v_version uuid;
begin
  select * into v_card from public.monthly_timecards where id=p_card for update;
  select * into v_profile from public.profiles where id=auth.uid() and active;
  if v_card.id is null or v_card.status<>'submitted' or not exists(
    select 1 from public.supervisor_assignments
    where employee_id=v_card.employee_id and supervisor_id=auth.uid() and active
  ) then
    raise exception 'This timecard is not available for your review';
  end if;
  if p_action='returned' then
    if length(trim(coalesce(p_reason,'')))<3 then raise exception 'A return explanation is required'; end if;
    update public.monthly_timecards set
      status='returned',returned_at=now(),return_reason=trim(p_reason),
      current_version=current_version+1
    where id=p_card returning * into v_card;
  elsif p_action='approved' then
    if lower(trim(coalesce(p_signature,'')))<>lower(trim(v_profile.display_name)) then
      raise exception 'Type your full name exactly to approve this timecard';
    end if;
    select id into v_version from public.timecard_versions
    where timecard_id=p_card and version=v_card.current_version;
    if v_version is null then raise exception 'Submitted version not found'; end if;
    insert into public.supervisor_approvals(
      timecard_version_id,supervisor_id,typed_signature,affirmation
    ) values(
      v_version,auth.uid(),trim(p_signature),
      'I have reviewed this employee''s timecard and approve the hours recorded for this pay period. To the best of my knowledge, the timecard accurately reflects the employee''s reported hours worked. By selecting Approve & Sign, I intend to electronically sign and approve this timecard.'
    );
    update public.monthly_timecards set
      status='approved',approved_at=now(),approved_by=auth.uid(),return_reason=null
    where id=p_card returning * into v_card;
  else
    raise exception 'Review action must be returned or approved';
  end if;
  return v_card;
end
$$;

grant execute on function public.submit_monthly_timecard(uuid,text,jsonb) to authenticated;
grant execute on function public.review_monthly_timecard(uuid,text,text,text) to authenticated;
