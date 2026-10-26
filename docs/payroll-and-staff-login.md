# Payroll submission and staff login

Submission opens at midnight Pacific on the 27th of each timecard month. The existing final-day noon deadline and late-submission availability remain.

Rachel can add Saturday or other future scheduled work with Add time / anticipated hours and select Anticipated hours. Start, end, breaks, month, and overlap validation still apply. Anticipated entries remain labeled in review, printouts, calendar, and the payroll CSV. Differences must be reported for a return/correction or an amendment after approval; the signed snapshot remains preserved.

In Payroll administration > Staff management, Rachel can create Ted as a Supervisor using tyuen@maccov.org if no account exists. For an existing account, Set up / reset login shows his email and a new temporary password once. This replaces the previous password and requires Ted to choose his own password on sign-in. The endpoint permits active administrators with completed password setup to reset only active employee/supervisor accounts in their own organization. Passwords are never stored in the audit log.

Use the supervisor selector beside Rachel's administrator account to assign Ted to her own timecard, as well as assigning employees. Ted uses My timecard for his own hours and Supervisor review for assigned submissions.

## Release order

1. Apply supabase/migrations/202610260001_payroll_early_submission.sql to the existing Supabase project. It runs in a transaction and changes no historical signed certifications.
2. Deploy the matching app revision to the existing mcc-timecards Vercel project in Anchor Studios.
3. Verify Rachel's staff-management action, Ted's supervisor assignment, a draft anticipated entry, and submission from the 27th in Pacific time. Do not sign or submit real payroll on another person's behalf.

## Validation

Eleven Node tests cover Pacific midnight, 27th-and-later availability, future months, February/leap year, late flags, and wall-time conversion. Application TypeScript and changed-file ESLint checks pass. A Next.js production build passes. An isolated PostgreSQL check applied all 13 migrations and verified future anticipated entries, rejection of future actual entries and early submissions, late submissions, and authoritative snapshot totals.

The legacy Vite configuration references an absent build/sites-vite-plugin; the production-app type check excludes that unused Vite configuration. Production uses Next.js.
