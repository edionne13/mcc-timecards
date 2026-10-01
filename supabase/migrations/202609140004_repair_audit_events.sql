-- Keep clock and manual-entry audit logging compatible with earlier MCC databases.
alter table public.audit_events
  add column if not exists subject_id uuid;
