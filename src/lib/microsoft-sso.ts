const STATE_COOKIE = "ms_sso_state";
const HANDOFF_COOKIE = "ms_sso_handoff";

export function getMicrosoftSsoConfig() {
  const clientId = String(process.env.MICROSOFT_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.MICROSOFT_CLIENT_SECRET || "").trim();
  const tenant = String(process.env.MICROSOFT_TENANT_ID || "organizations").trim() || "organizations";
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const redirectUri =
    String(process.env.MICROSOFT_REDIRECT_URI || "").trim() ||
    `${appUrl}/api/employee/auth/microsoft/callback`;

  return {
    clientId,
    clientSecret,
    tenant,
    redirectUri,
    appUrl,
    configured: Boolean(clientId && clientSecret),
  };
}

export function microsoftAuthorizeUrl(state: string): string {
  const { clientId, tenant, redirectUri } = getMicrosoftSsoConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "openid profile email User.Read",
    state,
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeMicrosoftCode(code: string): Promise<{ accessToken: string }> {
  const { clientId, clientSecret, tenant, redirectUri } = getMicrosoftSsoConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: "openid profile email User.Read",
  });

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || "Microsoft token exchange failed");
  }
  return { accessToken: data.access_token };
}

export type MicrosoftProfile = {
  mail?: string | null;
  userPrincipalName?: string | null;
  displayName?: string | null;
};

export async function fetchMicrosoftProfile(accessToken: string): Promise<MicrosoftProfile> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as MicrosoftProfile & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(data.error?.message || "Failed to load Microsoft profile");
  }
  return data;
}

export function microsoftEmails(profile: MicrosoftProfile): string[] {
  const values = [profile.mail, profile.userPrincipalName]
    .map((value) => String(value || "").trim())
    .filter((value) => value.includes("@"));
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

export function microsoftLocalPart(profile: MicrosoftProfile): string {
  const upn = String(profile.userPrincipalName || profile.mail || "").trim();
  return upn.split("@")[0]?.trim() || "";
}

export const microsoftSsoCookies = {
  state: STATE_COOKIE,
  handoff: HANDOFF_COOKIE,
};

export function ssoCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
