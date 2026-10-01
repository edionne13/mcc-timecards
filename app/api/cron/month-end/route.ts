import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  if (process.env.EMAIL_NOTIFICATIONS_ENABLED !== "true")
    return NextResponse.json({ skipped: true, reason: "Email notifications are disabled" });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.EMAIL_FROM) return NextResponse.json({ error: "EMAIL_FROM is not configured" }, { status: 503 });
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setUTCDate(now.getUTCDate() + 1);
  if (tomorrow.getUTCDate() !== 1) return NextResponse.json({ skipped: true });
  const db = createServiceClient();
  const period = now.toISOString().slice(0, 7);
  const { data: cards } = await db.from("monthly_timecards").select("employee_id,profiles!monthly_timecards_employee_id_fkey(display_name)").eq("month", `${period}-01`).in("status", ["draft", "returned"]);
  const resend = new Resend(process.env.RESEND_API_KEY);
  let sent = 0;
  for (const card of cards ?? []) {
    const key = `${card.employee_id}:month_due:${period}`;
    const { error } = await db.from("notification_events").insert({ organization_id: (await db.from("profiles").select("organization_id").eq("id", card.employee_id).single()).data?.organization_id, recipient_id: card.employee_id, kind: "month_due", period, status: "sending" });
    if (error?.code === "23505") continue;
    const user = await db.auth.admin.getUserById(card.employee_id);
    if (!user.data.user?.email) continue;
    const result = await resend.emails.send({ from: process.env.EMAIL_FROM, to: user.data.user.email, subject: "Your monthly timecard is due", text: "Your monthly timecard is due. Please review your hours, make any necessary corrections, and submit your timecard for approval." }, { headers: { "Idempotency-Key": key } });
    await db.from("notification_events").update({ status: result.error ? "failed" : "sent", provider_id: result.data?.id ?? null }).eq("recipient_id", card.employee_id).eq("kind", "month_due").eq("period", period);
    if (!result.error) sent++;
  }
  return NextResponse.json({ sent });
}
