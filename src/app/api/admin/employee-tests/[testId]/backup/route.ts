import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { readEmployeeTestBackup } from "@/services/employee-test-backup";

export const runtime = "nodejs";

/**
 * Pull the latest immutable snapshot for a portal test.
 * Does not change live pending/completed rows.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ testId: string }> }
) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { testId } = await params;
  if (!testId) {
    return NextResponse.json({ error: "Test ID is required" }, { status: 400 });
  }

  const backup = await readEmployeeTestBackup(testId);
  if (!backup) {
    return NextResponse.json({ error: "No backup found for this test." }, { status: 404 });
  }

  return NextResponse.json({ success: true, testId, backup });
}
