import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import { syncLocalTestStateToSupabase } from "@/services/employee-test-supabase-sync";
import { getOwnedTest } from "@/lib/employee-test-access";
import {
  canSubmitTest,
  EMPLOYEE_PROCTOR_MAX_VIOLATIONS,
  normalizeProctoring,
  recordProctorViolation,
} from "@/lib/employee-proctoring";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: testId } = await params;
    const auth = await authenticateRequestAsync(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const owned = await getOwnedTest(testId, auth.employeeId);
    if (!owned) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }

    const { test } = owned;
    if (test.status === "completed") {
      return NextResponse.json({
        success: true,
        proctoring: normalizeProctoring(test.proctoring),
        autoSubmit: false,
        ignored: true,
      });
    }

    const submitCheck = canSubmitTest(test);
    if (!submitCheck.ok && test.status === "in_progress") {
      // Allow violations to be logged even near expiry; block only completed tests
    } else if (!submitCheck.ok && test.status !== "in_progress") {
      return NextResponse.json({ error: submitCheck.error }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const violationType = String(body.violationType || "Unknown Violation").slice(0, 120);
    const detail = body.detail ? String(body.detail).slice(0, 240) : undefined;
    const category = body.category ? String(body.category) : undefined;
    const severity = body.severity ? String(body.severity) : undefined;

    const existing = normalizeProctoring(test.proctoring);
    const proctoring = recordProctorViolation(existing, violationType, {
      detail,
      category: category as any,
      severity: severity as any,
    });

    await localTestsDb.updateTest(testId, { proctoring });

    try {
      await syncLocalTestStateToSupabase(testId, auth.employee);
    } catch (syncErr) {
      console.warn("Failed to sync proctoring to Supabase:", syncErr);
    }

    const shouldAutoSubmit =
      proctoring.autoSubmitted &&
      !existing.autoSubmitted &&
      proctoring.warningCount >= EMPLOYEE_PROCTOR_MAX_VIOLATIONS;

    return NextResponse.json({
      success: true,
      proctoring,
      autoSubmit: shouldAutoSubmit,
    });
  } catch (error: unknown) {
    console.error("Proctor violation persist failed:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
