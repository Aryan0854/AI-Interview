import { NextRequest, NextResponse } from "next/server";
import {
  cacheEmployeeAccount,
} from "@/services/employee-account-store";
import {
  getEmployeeAccountAsync,
  getEmployeeByEmailAsync,
  signToken,
  syncEmployeeToSupabase,
} from "@/lib/employee-auth";
import {
  exchangeMicrosoftCode,
  fetchMicrosoftProfile,
  getMicrosoftSsoConfig,
  microsoftEmails,
  microsoftLocalPart,
  microsoftSsoCookies,
  ssoCookieOptions,
} from "@/lib/microsoft-sso";
import { getClientIp, isRateLimited } from "@/lib/security";
import { auditLogService } from "@/services/audit-log-service";

function errorRedirect(message: string) {
  const { appUrl } = getMicrosoftSsoConfig();
  return NextResponse.redirect(`${appUrl}/employee?sso_error=${encodeURIComponent(message)}`);
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const limitCheck = isRateLimited(`employee_ms_sso_cb_${ip}`, 20, 60000);
  if (limitCheck.limited) {
    return errorRedirect("Too many sign-in attempts. Try again shortly.");
  }

  const { configured, appUrl } = getMicrosoftSsoConfig();
  if (!configured) {
    return errorRedirect("Microsoft SSO is not configured.");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error") || "";
  const expectedState = request.cookies.get(microsoftSsoCookies.state)?.value || "";

  if (oauthError) {
    return errorRedirect(oauthError);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return errorRedirect("Microsoft sign-in was cancelled or could not be verified.");
  }

  try {
    const { accessToken } = await exchangeMicrosoftCode(code);
    const profile = await fetchMicrosoftProfile(accessToken);
    const emails = microsoftEmails(profile);

    let employee = null;
    for (const email of emails) {
      employee = await getEmployeeByEmailAsync(email);
      if (employee) break;
    }
    if (!employee) {
      const local = microsoftLocalPart(profile);
      if (local) employee = await getEmployeeAccountAsync(local);
    }

    if (!employee) {
      await auditLogService.addLog({
        actorEmail: emails[0] || "unknown",
        action: "EMPLOYEE_MICROSOFT_SSO_FAILURE",
        target: "Employee Portal",
        details: "Microsoft account is not linked to an Employee Portal roster email or ID.",
        ipAddress: ip,
      });
      return errorRedirect(
        "No Employee Portal account is linked to this Microsoft email. Sign in with your Employee ID or ask HR to map your work email."
      );
    }

    const token = signToken(employee.employee_id);
    cacheEmployeeAccount(employee);
    await syncEmployeeToSupabase(employee);
    await auditLogService.addLog({
      actorEmail: employee.email || emails[0] || employee.employee_id,
      action: "EMPLOYEE_MICROSOFT_SSO_SUCCESS",
      target: "Employee Portal",
      details: `Microsoft SSO login as ${employee.full_name} (${employee.employee_id}).`,
      ipAddress: ip,
    });

    const response = NextResponse.redirect(`${appUrl}/employee/sso-complete`);
    response.cookies.set(microsoftSsoCookies.state, "", { ...ssoCookieOptions(0), maxAge: 0 });
    response.cookies.set(microsoftSsoCookies.handoff, token, ssoCookieOptions(120));
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Microsoft SSO failed";
    console.error("Microsoft SSO callback error:", error);
    return errorRedirect(message);
  }
}
