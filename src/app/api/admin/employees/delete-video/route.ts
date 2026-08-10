import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import { supabase } from "@/lib/db";
import { writeLog } from "@/lib/structured-logger";
import { cacheStore } from "@/lib/cache-store";
import { deleteEmployeeTestVideo } from "@/lib/employee-test-video";

/**
 * POST /api/admin/employees/delete-video
 * Deletes ONLY the proctoring video file from storage (Supabase + local fallback).
 * Does not change test status, scores, attempts, or assigned questions.
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

    await deleteEmployeeTestVideo(resolvedTestId);

    cacheStore.invalidate("employees");

    await writeLog(
      "employee",
      "ADMIN_DELETE_EMPLOYEE_TEST_VIDEO",
      "success",
      `Admin deleted proctoring video only for test ${resolvedTestId}${employeeId ? ` (employee ${employeeId})` : ""}`
    );

    return NextResponse.json({
      success: true,
      testId: resolvedTestId,
      message: "Proctoring video deleted. Test score and status unchanged.",
    });
  } catch (error: any) {
    await writeLog(
      "employee",
      "ADMIN_DELETE_EMPLOYEE_TEST_VIDEO_FAILED",
      "failed",
      `Admin delete video failed: ${error.message}`
    );
    return NextResponse.json({ error: error.message || "Internal error" }, { status: 500 });
  }
}
