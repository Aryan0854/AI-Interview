import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import { supabase } from "@/lib/db";
import { writeLog } from "@/lib/structured-logger";
import { cacheStore } from "@/lib/cache-store";
import { deleteEmployeeTestVideo } from "@/lib/employee-test-video";
import { resetTestInSupabase, clearLocalTestSnapshotAfterReset, resolveEmployeeUuid } from "@/services/employee-test-supabase-sync";

/**
 * POST /api/admin/employees/reset-test
 * Resets an employee test session while keeping the originally assigned questions.
 */
export async function POST(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const testId = String(body.testId ?? "").trim();
    const employeeId = String(body.employeeId ?? "").trim();

    if (!testId && !employeeId) {
      return NextResponse.json({ error: "testId or employeeId is required" }, { status: 400 });
    }

    let resolvedTestId = testId;

    if (!resolvedTestId && employeeId) {
      const localTest = await localTestsDb.getTest(employeeId, "resource-product-assessment");
      if (localTest?.id) {
        resolvedTestId = localTest.id;
      } else {
        const { data } = await supabase
          .from("employees")
          .select("id")
          .eq("employee_id", employeeId)
          .maybeSingle();

        if (data?.id) {
          const { data: testRow } = await supabase
            .from("tests")
            .select("id")
            .eq("employee_id", data.id)
            .eq("topic_id", "resource-product-assessment")
            .maybeSingle();
          resolvedTestId = testRow?.id ?? "";
        }
      }
    }

    if (!resolvedTestId) {
      return NextResponse.json({ error: "Assigned test not found for this employee" }, { status: 404 });
    }

    const existingQuestions = await localTestsDb.getQuestions(resolvedTestId);

    // Delete recording first so a retake always starts clean.
    await deleteEmployeeTestVideo(resolvedTestId);

    // Postgres is source of truth in production.
    await resetTestInSupabase(resolvedTestId);
    await clearLocalTestSnapshotAfterReset(resolvedTestId);

    try {
      await localTestsDb.updateTest(resolvedTestId, {
        status: "pending",
        in_progress: null,
        current_question_index: 0,
        started_at: null,
        completed_at: null,
        session_recording_url: null as any,
        proctoring: null as any,
        score_correct: null,
        score_total: null,
        score_percent: null,
        ai_analysis: null,
      });
      await localTestsDb.deleteAttempts(resolvedTestId);
    } catch {
      // test may exist only in Supabase after migration
    }

    if (employeeId) {
      try {
        const employeeUuid = await resolveEmployeeUuid(employeeId);
        await supabase
          .from("employees")
          .update({
            ai_readiness_score: 0,
            xp_points: 0,
            skill_level: "beginner",
            updated_at: new Date().toISOString(),
          })
          .eq("id", employeeUuid);
      } catch {
        // non-fatal
      }
    }

    // Best-effort second delete in case upload raced with reset.
    await deleteEmployeeTestVideo(resolvedTestId);
    cacheStore.invalidate("employees");

    await writeLog(
      "employee",
      "ADMIN_RESET_EMPLOYEE_TEST",
      "success",
      `Admin reset test ${resolvedTestId}${employeeId ? ` for employee ${employeeId}` : ""} (questions preserved: ${existingQuestions.length})`
    );

    return NextResponse.json({
      success: true,
      testId: resolvedTestId,
      preservedQuestions: existingQuestions.length,
    });
  } catch (error: any) {
    await writeLog(
      "employee",
      "ADMIN_RESET_EMPLOYEE_TEST_FAILED",
      "failed",
      `Admin reset test failed: ${error.message}`
    );
    return NextResponse.json({ error: error.message || "Internal error" }, { status: 500 });
  }
}
