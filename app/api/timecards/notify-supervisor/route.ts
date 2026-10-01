import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/server";
import { decryptOutlookRefreshToken, outlookConfigured, refreshOutlookAccessToken, sendOutlookMail } from "@/lib/outlook-mail";

const SUPERVISOR_EMAIL = "tyuen@maccov.org";

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServiceClient();
  const { data: auth } = await db.auth.getUser(token);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { timecardId } = (await request.json()) as { timecardId?: string };
  const { data: card } = await db
    .from("monthly_timecards")
    .select("id,employee_id,month,status,current_version,profiles!monthly_timecards_employee_id_fkey(display_name)")
    .eq("id", timecardId ?? "")
    .single();

  if (!card || card.employee_id !== auth.user.id || card.status !== "submitted")
    return NextResponse.json({ error: "Submitted timecard not found" }, { status: 404 });

  if (process.env.EMAIL_NOTIFICATIONS_ENABLED !== "true")
    return NextResponse.json({ queued: true, email: false, reason: "Email sender is not enabled" });

  const employee = Array.isArray(card.profiles) ? card.profiles[0] : card.profiles;
  const month = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(`${card.month}T12:00:00`));
  const subject = `Timecard ready for review: ${employee?.display_name ?? "MCC employee"} — ${month}`;
  const text = `${employee?.display_name ?? "An MCC employee"} submitted a monthly timecard for ${month}. Review and electronically sign it at https://mcc-timecards.vercel.app/.`;
  const { data: employeeProfile } = await db.from("profiles").select("organization_id").eq("id", card.employee_id).single();
  if (outlookConfigured() && employeeProfile?.organization_id) {
    const { data: connection } = await db.from("outlook_email_connections").select("outlook_email,refresh_token_ciphertext").eq("organization_id", employeeProfile.organization_id).maybeSingle();
    if (connection) {
      try {
        const accessToken = await refreshOutlookAccessToken(decryptOutlookRefreshToken(connection.refresh_token_ciphertext));
        const id = await sendOutlookMail({ accessToken, to: SUPERVISOR_EMAIL, subject, text });
        return NextResponse.json({ queued: true, email: true, provider: "outlook", id });
      } catch (error) {
        return NextResponse.json({ queued: true, email: false, provider: "outlook", error: error instanceof Error ? error.message : "Outlook notification failed" }, { status: 502 });
      }
    }
  }
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
    return NextResponse.json({ queued: true, email: false, reason: "Outlook email is not connected and no verified backup sender is configured" });
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send(
    {
      from: process.env.EMAIL_FROM,
      to: SUPERVISOR_EMAIL,
      subject,
      text,
    },
    { headers: { "Idempotency-Key": `supervisor-review-${card.id}-v${card.current_version}` } },
  );

  if (result.error)
    return NextResponse.json({ queued: true, email: false, error: result.error.message }, { status: 502 });
  return NextResponse.json({ queued: true, email: true, id: result.data?.id });
}
