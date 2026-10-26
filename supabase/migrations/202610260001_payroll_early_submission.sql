-- Open submission on the 27th and preserve anticipated time as a distinct record.
begin;
alter table public.work_shifts add column if not exists anticipated boolean not null default false;

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
  if new.anticipated and (new.source<>'manual' or new.ended_at is null) then
    raise exception 'Anticipated hours require a completed manual start and end time';
  end if;
  if not new.anticipated and (new.started_at > now()+interval '5 minutes' or new.ended_at > now()+interval '5 minutes') then
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


create or replace function public.prevent_early_timecard_submission()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_opens date := (date_trunc('month', new.month) + interval '26 days')::date;
begin
  if new.status = 'submitted'
     and old.status is distinct from new.status
     and v_today < v_opens then
    raise exception 'Timecard submission opens on %', to_char(v_opens, 'FMMonth FMDD');
  end if;
  return new;
end
$$;

drop trigger if exists prevent_early_timecard_submission on public.monthly_timecards;
create trigger prevent_early_timecard_submission
before update of status on public.monthly_timecards
for each row execute function public.prevent_early_timecard_submission();

create or replace function public.audit_shift_change() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.started_at is distinct from new.started_at or (old.ended_at is not null and old.ended_at is distinct from new.ended_at) or old.break_minutes is distinct from new.break_minutes or old.anticipated is distinct from new.anticipated then
    if coalesce(length(trim(new.correction_reason)),0) < 3 then raise exception 'Reason for correction is required'; end if;
    new.corrected := true; new.updated_at := now();
    insert into audit_events(organization_id,actor_id,subject_id,action,before_value,after_value)
    values(new.organization_id,auth.uid(),new.id,'shift_corrected',to_jsonb(old),to_jsonb(new));
  end if;
  return new;
end $$;
drop trigger if exists audit_work_shift_change on public.work_shifts;
create trigger audit_work_shift_change before update on public.work_shifts for each row execute function public.audit_shift_change();


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
  v_opens date;
  v_snapshot jsonb;
begin
  select * into v_card from public.monthly_timecards where id=p_card for update;
  select * into v_profile from public.profiles where id=auth.uid() and active;
  if v_profile.id is null or v_profile.must_change_password or v_card.id is null or v_card.employee_id<>auth.uid() or v_card.status not in ('draft','returned') then
    raise exception 'This timecard cannot be submitted';
  end if;
  if lower(trim(coalesce(p_signature,'')))<>lower(trim(v_profile.display_name)) then
    raise exception 'Type your full name exactly to sign this timecard';
  end if;
  v_opens := (date_trunc('month',v_card.month)+interval '26 days')::date;
  if v_today<v_opens then
    raise exception 'Timecard submission opens on %',to_char(v_opens,'FMMonth FMDD');
  end if;
  if exists(select 1 from public.work_shifts where timecard_id=p_card and ended_at is null) then
    raise exception 'Clock out before submitting this timecard';
  end if;
  if not exists(select 1 from public.work_shifts where timecard_id=p_card) then
    raise exception 'Add at least one time entry before submitting';
  end if;

  select coalesce(p_snapshot,'{}'::jsonb) || jsonb_build_object(
    'shifts',jsonb_agg(to_jsonb(s) order by s.started_at),
    'total_minutes',sum(greatest(0,round(extract(epoch from (s.ended_at-s.started_at))/60)-s.break_minutes)),
    'anticipated_minutes',coalesce(sum(greatest(0,round(extract(epoch from (s.ended_at-s.started_at))/60)-s.break_minutes)) filter(where s.anticipated),0)
  ) into v_snapshot from public.work_shifts s where s.timecard_id=p_card;

  insert into public.timecard_versions(timecard_id,version,snapshot,locked_at)
  values(p_card,v_card.current_version,v_snapshot,now())
  returning id into v_version;

  insert into public.employee_certifications(
    timecard_version_id,employee_id,display_name,typed_signature,
    certification_text,certification_version
  ) values(
    v_version,auth.uid(),v_profile.display_name,trim(p_signature),
    'I certify that this timecard accurately records my hours worked and separately identifies hours I anticipate working for the remainder of this month. I have reviewed the recorded time and breaks. I will promptly report any difference between anticipated and actual hours to my supervisor so the timecard can be corrected or amended. By selecting Sign & Submit, I intend to electronically sign this timecard and certify that the information provided is accurate to the best of my knowledge.',
    '4'
  );

  update public.monthly_timecards set
    status='submitted',submitted_at=now(),returned_at=null,return_reason=null
  where id=p_card returning * into v_card;
  return v_card;
end
$$;


commit;
