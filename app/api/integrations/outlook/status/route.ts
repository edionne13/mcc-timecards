import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { outlookConfigured } from "@/lib/outlook-mail";

export async function GET(request: Request) {
  const configured = outlookConfigured();
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return NextResponse.json({ configured, connected: false, email: null });
  const db = createServiceClient();
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return NextResponse.json({ configured, connected: false, email: null });
  const { data: profile } = await db.from("profiles").select("role,organization_id").eq("id", user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const { data } = await db.from("outlook_email_connections").select("outlook_email,connected_at").eq("organization_id", profile.organization_id).maybeSingle();
  return NextResponse.json({ configured, connected: Boolean(data), email: data?.outlook_email ?? null, connectedAt: data?.connected_at ?? null });
}
