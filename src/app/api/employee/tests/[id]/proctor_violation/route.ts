import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import { syncLocalTestStateToSupabase } from "@/services/employee-test-supabase-sync";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: testId } = await params;
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const violationType = String(body.violationType || "Unknown");
    const warningCount = Number(body.warningCount || 0);
    const autoSubmitted = body.autoSubmitted === true;

    const test = await localTestsDb.getTestById(testId);
    if (!test || test.employee_id !== auth.employeeId) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }

    const existing = test.proctoring ?? { warningCount: 0, violations: [], autoSubmitted: false };
    const proctoring = {
      warningCount,
      autoSubmitted: autoSubmitted || existing.autoSubmitted,
      violations: [
        ...existing.violations,
        { type: violationType, timestamp: new Date().toISOString() },
      ],
    };

    await localTestsDb.updateTest(testId, { proctoring });

    try {
      await syncLocalTestStateToSupabase(testId, auth.employee);
    } catch (syncErr) {
      console.warn("Failed to sync proctoring to Supabase:", syncErr);
    }

    return NextResponse.json({ success: true, proctoring });
  } catch (error: any) {
    console.error("Proctor violation persist failed:", error);
    return NextResponse.json({ error: error.message || "Internal error" }, { status: 500 });
  }
}
