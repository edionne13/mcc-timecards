# MCC Timecards

Simple church-staff timekeeping: employee entry and certification, supervisor review, administrator payroll readiness, and immutable amendments.

## Local setup

Requires Node.js 22+. Run `npm install`, then `npm run dev`. Verify with `npm test` and `npm run build`.

## Production setup

Apply `supabase/migrations/202609140001_initial.sql` to a new Supabase project, enable invite-only authentication, and set these Vercel variables:

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser-safe anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` — server-only privileged key
- `RESEND_API_KEY` — server-only email key
- `EMAIL_FROM` — verified sender address
- `CRON_SECRET` — secret for scheduled reminder requests
- `NEXT_PUBLIC_APP_URL` — canonical production URL

The organization timezone is `America/Los_Angeles`. Configure the month-end reminder for approximately noon on the last calendar day. The `notification_events` unique constraint prevents duplicate delivery.

## Security and records

The migration enables RLS and scopes employee and supervisor reads. Approved entries cannot be updated through the employee policy. Sensitive workflow actions must remain server-side and transactional. Never cascade-delete historical records; deactivate accounts instead.

Enable Supabase managed backups according to the selected plan, document MCC's retention period, and test restores into an isolated project.

The interface currently uses representative September 2026 data so all three roles can be reviewed without production credentials. Use the header role picker to switch views.

## Policy review before launch

Oregon counsel, MCC's accountant, and its payroll provider should approve the configured workweek, overtime threshold, meal timing and minimums, anticipated-time certification wording, amendment approval process, reminder timing, and retention period. Application warnings are review aids, not legal conclusions.
