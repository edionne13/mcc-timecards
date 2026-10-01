-- Employees may remove an incorrect draft/returned entry while preserving a
-- complete audit record of what was deleted and why.
create or replace function public.delete_work_shift(p_shift uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_shift public.work_shifts;
begin
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Reason for deletion is required';
  end if;

  select s.* into v_shift
  from public.work_shifts s
  join public.monthly_timecards c on c.id = s.timecard_id
  where s.id = p_shift
    and s.employee_id = auth.uid()
    and c.employee_id = auth.uid()
    and c.status in ('draft', 'returned')
  for update of s;

  if v_shift.id is null then
    raise exception 'This time entry cannot be deleted';
  end if;

  insert into public.audit_events(
    organization_id,
    actor_id,
    subject_id,
    action,
    before_value,
    after_value
  ) values (
    v_shift.organization_id,
    auth.uid(),
    v_shift.id,
    'shift_deleted',
    to_jsonb(v_shift),
    jsonb_build_object('reason', trim(p_reason))
  );

  delete from public.work_shifts where id = v_shift.id;
end
$$;

revoke all on function public.delete_work_shift(uuid,text) from public;
grant execute on function public.delete_work_shift(uuid,text) to authenticated;

notify pgrst, 'reload schema';
