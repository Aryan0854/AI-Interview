export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { resetLogService } from "@/services/reset-log-service";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { writeLog } from "@/lib/structured-logger";

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const logs = await resetLogService.getLogs();
    return NextResponse.json({ logs });
  } catch (error: any) {
    console.error("Failed to read reset logs:", error);
    return NextResponse.json({ error: "Failed to read reset logs" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await resetLogService.clearLogs();
    await writeLog('candidate-processing', 'CLEAR_RESET_LOGS', 'success', 'Cleared all candidate reset logs');
    return NextResponse.json({ success: true, logs: [] });
  } catch (error: any) {
    console.error("Failed to clear reset logs:", error);
    await writeLog('candidate-processing', 'CLEAR_RESET_LOGS_FAILED', 'failed', `Failed to clear candidate reset logs: ${error.message}`);
    return NextResponse.json({ error: "Failed to clear reset logs" }, { status: 500 });
  }
}
