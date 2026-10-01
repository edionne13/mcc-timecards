import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { googleConfigured } from "@/lib/google-mail";

export async function GET() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createServiceClient();
  const { data: profile } = await db.from("profiles").select("role,organization_id").eq("id", user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const { data } = await db.from("google_email_connections").select("google_email,connected_at").eq("organization_id", profile.organization_id).maybeSingle();
  return NextResponse.json({ configured: googleConfigured(), connected: Boolean(data), email: data?.google_email ?? null, connectedAt: data?.connected_at ?? null });
}
