import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SCOPE = "openid email https://www.googleapis.com/auth/gmail.send";

function secret() {
  const value = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error("Google email encryption key is not configured");
  return createHmac("sha256", "mcc-timecards-google-mail").update(value).digest();
}

export function googleConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  );
}

export function googleRedirectUri(origin: string) {
  return `${origin}/api/integrations/google/callback`;
}

export function createOAuthState(payload: { userId: string; organizationId: string }) {
  const body = Buffer.from(JSON.stringify({ ...payload, createdAt: Date.now() })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function readOAuthState(state: string) {
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

export function googleAuthorizationUrl(origin: string, state: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(origin),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
    login_hint: "officeadmin@maccov.org",
  }).toString();
  return url;
}

export function encryptRefreshToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((value) => value.toString("base64url")).join(".");
}

export function decryptRefreshToken(value: string) {
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", secret(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "Google token refresh failed");
  return data.access_token;
}

function encodeMessage(value: string) {
  return Buffer.from(value).toString("base64url");
}

export async function sendGmail(args: {
  accessToken: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}) {
  const subject = `=?UTF-8?B?${Buffer.from(args.subject).toString("base64")}?=`;
  const raw = encodeMessage(
    [`From: MCC Timecards <${args.from}>`, `To: ${args.to}`, `Subject: ${subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", args.text].join("\r\n"),
  );
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${args.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const data = (await response.json()) as { id?: string; error?: { message?: string } };
  if (!response.ok || !data.id) throw new Error(data.error?.message || "Gmail send failed");
  return data.id;
}
