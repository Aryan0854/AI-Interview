import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import { supabase } from "@/lib/db";
import { writeLog } from "@/lib/structured-logger";
import { cacheStore } from "@/lib/cache-store";
import { deleteEmployeeTestVideo } from "@/lib/employee-test-video";

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
    let resetViaLocal = false;

    try {
      const { data: testRow, error } = await supabase
        .from("tests")
        .select("id, employee_id, total_questions")
        .eq("id", resolvedTestId)
        .maybeSingle();

      if (!error && testRow) {
        await supabase.from("test_attempts").delete().eq("test_id", resolvedTestId);

        const { error: updateErr } = await supabase
          .from("tests")
          .update({
            status: "pending",
            in_progress: null,
            current_question_index: 0,
            started_at: null,
            completed_at: null,
            session_recording_url: null,
            proctoring: null,
            score_correct: null,
            score_total: null,
            score_percent: null,
            ai_analysis: null,
          })
          .eq("id", resolvedTestId);

        if (updateErr) throw updateErr;
      } else {
        resetViaLocal = true;
      }
    } catch {
      resetViaLocal = true;
    }

    if (resetViaLocal) {
      const localTest = await localTestsDb.getTestById(resolvedTestId);
      if (!localTest) {
        return NextResponse.json({ error: "Test not found" }, { status: 404 });
      }

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
      await deleteEmployeeTestVideo(resolvedTestId);
    }

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
