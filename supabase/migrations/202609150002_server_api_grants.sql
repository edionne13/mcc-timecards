-- Narrow grants for the server-only MCC API routes. Row-level security remains
-- enabled for all browser-facing anon and authenticated access.
grant usage on schema public to service_role;
grant select, update on public.profiles to service_role;
grant select on public.monthly_timecards to service_role;
grant select, insert, update on public.supervisor_assignments to service_role;
grant select, insert, update on public.notification_events to service_role;
grant select on public.google_email_connections to service_role;
grant select, insert, update on public.outlook_email_connections to service_role;
