import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createOAuthState, googleAuthorizationUrl, googleConfigured } from "@/lib/google-mail";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  if (!googleConfigured()) return NextResponse.redirect(new URL("/?google=needs-setup", origin));
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/", origin));
  const db = createServiceClient();
  const { data: profile } = await db.from("profiles").select("role,organization_id").eq("id", user.id).single();
  if (profile?.role !== "admin") return NextResponse.redirect(new URL("/?google=admin-required", origin));
  const state = createOAuthState({ userId: user.id, organizationId: profile.organization_id });
  return NextResponse.redirect(googleAuthorizationUrl(origin, state));
}
