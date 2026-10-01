import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { encryptOutlookRefreshToken, outlookRedirectUri, outlookTokenUrl, readOutlookState } from "@/lib/outlook-mail";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const state = readOutlookState(url.searchParams.get("state") || "");
  const code = url.searchParams.get("code");
  if (!state || !code) {
    console.error("Outlook callback rejected: missing or expired signed state/code");
    return NextResponse.redirect(new URL("/?outlook=failed&reason=callback", origin));
  }
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET?.trim();
  if (!clientSecret) {
    console.error("Outlook callback rejected: client secret is not configured");
    return NextResponse.redirect(new URL("/?outlook=failed&reason=config", origin));
  }
  const tokenResponse = await fetch(outlookTokenUrl(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.OUTLOOK_CLIENT_ID!,
      client_secret: clientSecret,
      redirect_uri: outlookRedirectUri(origin),
      grant_type: "authorization_code",
      scope: "openid email profile offline_access https://graph.microsoft.com/Mail.Send",
    }),
  });
  const tokens = (await tokenResponse.json()) as { access_token?: string; refresh_token?: string; id_token?: string; error?: string; error_description?: string };
  if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) {
    console.error("Outlook token exchange failed", { status: tokenResponse.status, error: tokens.error, description: tokens.error_description });
    return NextResponse.redirect(new URL("/?outlook=failed&reason=token", origin));
  }
  const userResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const microsoftUser = (await userResponse.json()) as { mail?: string; userPrincipalName?: string };
  let tokenIdentity: { preferred_username?: string; email?: string; upn?: string } = {};
  try {
    tokenIdentity = JSON.parse(Buffer.from(tokens.id_token?.split(".")[1] || "", "base64url").toString());
  } catch {
    console.error("Outlook callback received an unreadable Microsoft identity token");
  }
  const identities = [
    microsoftUser.mail,
    microsoftUser.userPrincipalName,
    tokenIdentity.preferred_username,
    tokenIdentity.email,
    tokenIdentity.upn,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  if (!identities.includes("officeadmin@maccov.org"))
    return NextResponse.redirect(new URL("/?outlook=wrong-account", origin));
  const email = "officeadmin@maccov.org";
  const db = createServiceClient();
  const { error: saveError } = await db.from("outlook_email_connections").upsert({
    organization_id: state.organizationId,
    outlook_email: email,
    refresh_token_ciphertext: encryptOutlookRefreshToken(tokens.refresh_token),
    connected_by: state.userId,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (saveError) {
    console.error("Outlook connection save failed", { code: saveError.code, message: saveError.message });
    return NextResponse.redirect(new URL("/?outlook=failed&reason=save", origin));
  }
  return NextResponse.redirect(new URL("/?outlook=connected", origin));
}
