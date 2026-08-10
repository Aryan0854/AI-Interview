import { NextRequest, NextResponse } from "next/server";
import { settingsService } from "@/services/settings-service";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { checkCsrf, getClientIp } from "@/lib/security";
import { auditLogService } from "@/services/audit-log-service";
import { writeLog } from "@/lib/structured-logger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!checkCsrf(request)) {
    return NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 });
  }
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);

  try {
    const { settings, adminEmail } = await request.json();
    if (!settings || typeof settings !== "object") {
      return NextResponse.json({ error: "Invalid settings object" }, { status: 400 });
    }

    const updated = await settingsService.updateSettings(settings);

    // Audit Log
    await auditLogService.addLog({
      actorEmail: adminEmail || "admin@infinite.com",
      action: "ADMIN_UPDATE_PORTAL_SETTINGS",
      target: "portal-settings",
      details: `Updated portal settings: SystemLogsViewer=${updated.showSystemLogsViewer}`,
      ipAddress: ip,
    });

    await writeLog('employee', 'UPDATE_PORTAL_SETTINGS', 'success', `Updated portal settings: SystemLogsViewer=${updated.showSystemLogsViewer}`);
    return NextResponse.json({ success: true, settings: updated });
  } catch (error: any) {
    console.error("Failed to update portal settings:", error);
    await writeLog('employee', 'UPDATE_PORTAL_SETTINGS_FAILED', 'failed', `Failed to update portal settings: ${error.message}`);
    return NextResponse.json({ error: error.message || "Failed to update settings" }, { status: 500 });
  }
}
