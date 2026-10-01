import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { encryptRefreshToken, googleRedirectUri, readOAuthState } from "@/lib/google-mail";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const state = readOAuthState(url.searchParams.get("state") || "");
  const code = url.searchParams.get("code");
  if (!state || !code) return NextResponse.redirect(new URL("/?google=failed", origin));
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  const tokens = (await tokenResponse.json()) as { access_token?: string; refresh_token?: string };
  if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token)
    return NextResponse.redirect(new URL("/?google=failed", origin));
  const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const googleUser = (await userResponse.json()) as { email?: string };
  if (googleUser.email?.toLowerCase() !== "officeadmin@maccov.org")
    return NextResponse.redirect(new URL("/?google=wrong-account", origin));
  const db = createServiceClient();
  await db.from("google_email_connections").upsert({
    organization_id: state.organizationId,
    google_email: googleUser.email,
    refresh_token_ciphertext: encryptRefreshToken(tokens.refresh_token),
    connected_by: state.userId,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return NextResponse.redirect(new URL("/?google=connected", origin));
}
