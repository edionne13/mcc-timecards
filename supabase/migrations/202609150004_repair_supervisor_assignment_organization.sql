-- Repair older production databases where supervisor_assignments was created
-- before organization_id became part of the application contract.
alter table public.supervisor_assignments
  add column if not exists organization_id uuid references public.organizations(id);

update public.supervisor_assignments sa
set organization_id = p.organization_id
from public.profiles p
where p.id = sa.employee_id
  and sa.organization_id is null;

alter table public.supervisor_assignments
  alter column organization_id set not null;

notify pgrst, 'reload schema';
