import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  getMicrosoftSsoConfig,
  microsoftAuthorizeUrl,
  microsoftSsoCookies,
  ssoCookieOptions,
} from "@/lib/microsoft-sso";
import { getClientIp, isRateLimited } from "@/lib/security";

export async function GET(request: NextRequest) {
  const appUrl = getMicrosoftSsoConfig().appUrl;
  const ip = getClientIp(request);
  const limitCheck = isRateLimited(`employee_ms_sso_${ip}`, 12, 60000);
  if (limitCheck.limited) {
    return NextResponse.redirect(`${appUrl}/employee?sso_error=${encodeURIComponent("Too many sign-in attempts. Try again shortly.")}`);
  }

  const { configured } = getMicrosoftSsoConfig();
  if (!configured) {
    return NextResponse.redirect(
      `${appUrl}/employee?sso_error=${encodeURIComponent("Microsoft SSO is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.")}`
    );
  }

  const state = crypto.randomBytes(24).toString("hex");
  const response = NextResponse.redirect(microsoftAuthorizeUrl(state));
  response.cookies.set(microsoftSsoCookies.state, state, ssoCookieOptions(10 * 60));
  return response;
}
