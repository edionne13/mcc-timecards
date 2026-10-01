import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SCOPES = "openid email profile offline_access https://graph.microsoft.com/Mail.Send";
const MCC_TENANT_ID = "3dcbd013-3338-4a0f-915b-41e06c4ec272";

export function outlookTokenUrl() {
  return `https://login.microsoftonline.com/${MCC_TENANT_ID}/oauth2/v2.0/token`;
}

function secret() {
  const value = process.env.OUTLOOK_TOKEN_ENCRYPTION_KEY || process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error("Outlook email encryption key is not configured");
  return createHmac("sha256", "mcc-timecards-outlook-mail").update(value).digest();
}

export function outlookConfigured() {
  return Boolean(
    process.env.OUTLOOK_CLIENT_ID &&
      process.env.OUTLOOK_CLIENT_SECRET &&
      (process.env.OUTLOOK_TOKEN_ENCRYPTION_KEY || process.env.GOOGLE_TOKEN_ENCRYPTION_KEY),
  );
}

export function outlookRedirectUri(origin: string) {
  return `${origin}/api/integrations/outlook/callback`;
}

export function createOutlookState(payload: { userId: string; organizationId: string }) {
  const body = Buffer.from(JSON.stringify({ ...payload, createdAt: Date.now() })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function readOutlookState(state: string) {
  const [body, signature] = state.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  const value = JSON.parse(Buffer.from(body, "base64url").toString()) as {
    userId: string;
    organizationId: string;
    createdAt: number;
  };
  return Date.now() - value.createdAt < 10 * 60 * 1000 ? value : null;
}

export function outlookAuthorizationUrl(origin: string, state: string) {
  const url = new URL(`https://login.microsoftonline.com/${MCC_TENANT_ID}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: process.env.OUTLOOK_CLIENT_ID!,
    redirect_uri: outlookRedirectUri(origin),
    response_type: "code",
    response_mode: "query",
    scope: SCOPES,
    state,
    prompt: "select_account",
    login_hint: "officeadmin@maccov.org",
  }).toString();
  return url;
}

export function encryptOutlookRefreshToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((value) => value.toString("base64url")).join(".");
}

export function decryptOutlookRefreshToken(value: string) {
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", secret(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export async function refreshOutlookAccessToken(refreshToken: string) {
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET?.trim();
  if (!clientSecret) throw new Error("Outlook client secret is not configured");
  const response = await fetch(outlookTokenUrl(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.OUTLOOK_CLIENT_ID!,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: SCOPES,
    }),
  });
  const data = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "Outlook token refresh failed");
  return data.access_token;
}

export async function sendOutlookMail(args: { accessToken: string; to: string; subject: string; text: string }) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { authorization: `Bearer ${args.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: args.subject,
        body: { contentType: "Text", content: args.text },
        toRecipients: [{ emailAddress: { address: args.to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(data?.error?.message || "Outlook email failed");
  }
  return "accepted";
}
