-- Transaction-only integration checks: no fixture accounts or records persist.
begin;
do $$
declare
  u uuid := gen_random_uuid();
  c uuid;
  s uuid;
  snapshot jsonb;
  blocked boolean;
begin
  insert into auth.users(id,email,raw_user_meta_data)
  values(u,'pay-types-test-' || u || '@example.invalid','{"display_name":"Pay Types Test"}'::jsonb);
  update public.profiles set must_change_password=false where id=u;
  perform set_config('request.jwt.claim.sub',u::text,true);
  c := public.ensure_month_card(u,'2026-10-01T12:00:00-07:00');
  insert into public.work_shifts(organization_id,employee_id,timecard_id,started_at,ended_at,source,correction_reason,pay_type)
  values
    ('00000000-0000-0000-0000-000000000001',u,c,'2026-10-01T09:00:00-07:00','2026-10-01T17:00:00-07:00','manual','Test regular','regular'),
    ('00000000-0000-0000-0000-000000000001',u,c,'2026-10-01T00:00:00-07:00','2026-10-01T04:00:00-07:00','manual','Test vacation','vacation'),
    ('00000000-0000-0000-0000-000000000001',u,c,'2026-10-02T00:00:00-07:00','2026-10-02T08:00:00-07:00','manual','Test holiday','holiday'),
    ('00000000-0000-0000-0000-000000000001',u,c,'2026-10-03T00:00:00-07:00','2026-10-03T04:00:00-07:00','manual','Test sick','sick');
  select id into s from public.work_shifts where timecard_id=c and pay_type='sick';
  update public.work_shifts set pay_type='holiday',correction_reason='Test pay type correction' where id=s;
  if not exists(select 1 from public.audit_events where subject_id=s and action='shift_corrected' and after_value->>'pay_type'='holiday') then
    raise exception 'Pay type correction was not audited';
  end if;
  update public.work_shifts set pay_type='sick',correction_reason='Restore test category' where id=s;
  blocked := false;
  begin
    insert into public.work_shifts(organization_id,employee_id,timecard_id,started_at,ended_at,source,correction_reason,pay_type)
    values('00000000-0000-0000-0000-000000000001',u,c,'2026-10-03T00:00:00-07:00','2026-10-03T02:00:00-07:00','manual','Duplicate test','sick');
  exception when others then
    if sqlerrm like '%already has an entry%' then blocked:=true; else raise; end if;
  end;
  if not blocked then raise exception 'Duplicate paid leave was allowed'; end if;
  blocked := false;
  begin
    insert into public.work_shifts(organization_id,employee_id,timecard_id,started_at,ended_at,source,correction_reason,pay_type)
    values('00000000-0000-0000-0000-000000000001',u,c,'2026-10-01T10:00:00-07:00','2026-10-01T11:00:00-07:00','manual','Overlap test','regular');
  exception when others then
    if sqlerrm like '%overlaps%' then blocked:=true; else raise; end if;
  end;
  if not blocked then raise exception 'Overlapping work was allowed'; end if;
  perform public.submit_monthly_timecard(c,'Pay Types Test','{}'::jsonb);
  select v.snapshot into snapshot from public.timecard_versions v where timecard_id=c;
  if (snapshot->>'total_minutes')::integer <> 1440 or jsonb_array_length(snapshot->'shifts') <> 4 then
    raise exception 'Submission totals or entries are incorrect';
  end if;
  if (select count(distinct e->>'pay_type') from jsonb_array_elements(snapshot->'shifts') e) <> 4 then
    raise exception 'Submission lost pay categories';
  end if;
  blocked := false;
  begin
    update public.work_shifts set pay_type='holiday',correction_reason='Locked test' where id=s;
  exception when others then
    if sqlerrm like '%locked%' then blocked:=true; else raise; end if;
  end;
  if not blocked then raise exception 'Submitted entry could be changed'; end if;
end $$;
rollback;
select 'PASS: four pay types, mixed day, category edits and audit, duplicate protection, regular overlap protection, submission snapshot, and locked entries. Test data rolled back.' as result;
