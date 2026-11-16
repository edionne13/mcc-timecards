# Record hours or paid time off

1. Open **My timecard** and select the correct month.
2. Select **Add hours / paid time off**.
3. Choose **Regular hours worked**, **Vacation pay**, **Holiday pay**, or **Sick pay**.
4. For regular work, enter clock-in, clock-out, and unpaid breaks. For paid time off, enter the date and paid hours (for example, 8).
5. Select **Save time entry**. Review the separate category totals before signing and submitting.

Clock In / Clock Out always records regular work. For a day with both work and paid time off, save separate entries. Enter each paid time off category once per date; edit that entry to change its hours. Notes are optional for new paid time off, and required for corrections. Future scheduled regular work still uses Anticipated hours.

Payroll CSV includes a separate column for each category. Existing entries remain regular hours worked.

## Release
Apply supabase/migrations/202611160001_pay_types.sql before deploying the matching app commit. Verify a paid leave insert/edit and submission against a test account, then verify the category columns in payroll CSV. Do not release the UI before the database migration.
