import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createOutlookState, outlookAuthorizationUrl, outlookConfigured } from "@/lib/outlook-mail";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (!outlookConfigured()) return NextResponse.json({ error: "Outlook credentials are not configured" }, { status: 503 });
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createServiceClient();
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("role,organization_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError)
    return NextResponse.json({ error: `Profile lookup failed: ${profileError.message}` }, { status: 500 });
  if (!profile)
    return NextResponse.json({ error: "Your authenticated account does not have an MCC staff profile." }, { status: 403 });
  if (profile?.role !== "admin") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const state = createOutlookState({ userId: user.id, organizationId: profile.organization_id });
  return NextResponse.json({ url: outlookAuthorizationUrl(origin, state) });
}
