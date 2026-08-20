import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { getClientIp, isRateLimited } from "@/lib/security";
import { auditLogService } from "@/services/audit-log-service";
import { adminCanChangePassword, changeNamedAdminPassword } from "@/lib/admin-accounts-server";

export async function POST(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  const limitCheck = isRateLimited(`admin_change_password_${ip}`, 5, 60000);
  if (limitCheck.limited) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again after a minute." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const currentPassword = String(body.currentPassword ?? "");
    const newPassword = String(body.newPassword ?? "");

    if (!(await adminCanChangePassword(email))) {
      await auditLogService.addLog({
        actorEmail: email || "unknown",
        action: "ADMIN_PASSWORD_CHANGE_DENIED",
        target: "Admin Console",
        details: "Account is not allowed to change password",
        ipAddress: ip,
      });
      return NextResponse.json(
        { error: "This account cannot change its password here." },
        { status: 403 }
      );
    }

    const result = await changeNamedAdminPassword(email, currentPassword, newPassword);
    if (!result.ok) {
      await auditLogService.addLog({
        actorEmail: email,
        action: "ADMIN_PASSWORD_CHANGE_FAILURE",
        target: "Admin Console",
        details: result.error,
        ipAddress: ip,
      });
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    await auditLogService.addLog({
      actorEmail: email,
      action: "ADMIN_PASSWORD_CHANGE_SUCCESS",
      target: "Admin Console",
      details: "Named admin password updated",
      ipAddress: ip,
    });

    return NextResponse.json({ status: "ok" });
  } catch (error: any) {
    console.error("Admin password change error:", error);
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}
