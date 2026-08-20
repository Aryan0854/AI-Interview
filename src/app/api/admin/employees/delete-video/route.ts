import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import { supabase } from "@/lib/db";
import { writeLog } from "@/lib/structured-logger";
import { cacheStore } from "@/lib/cache-store";
import { deleteEmployeeTestVideo } from "@/lib/employee-test-video";

type DeleteVideoItem = { testId?: string; employeeId?: string };

async function resolveEmployeeTestId(
  testId: string,
  employeeId: string
): Promise<string> {
  if (testId) return testId;

  if (employeeId) {
    const localTest = await localTestsDb.getTest(employeeId, "resource-product-assessment");
    if (localTest?.id) return localTest.id;

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
      return testRow?.id ?? "";
    }
  }

  return "";
}

/**
 * POST /api/admin/employees/delete-video
 * Deletes ONLY the proctoring video file from storage (Supabase + local fallback).
 * Does not change test status, scores, attempts, or assigned questions.
 *
 * Single: { testId?, employeeId? }
 * Bulk:   { items: [{ testId?, employeeId? }, ...] }
 */
export async function POST(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? (body.items as DeleteVideoItem[]) : null;

    if (items && items.length > 0) {
      const deleted: string[] = [];
      const skipped: Array<{ employeeId?: string; testId?: string; error: string }> = [];

      for (const item of items) {
        const testId = String(item.testId ?? "").trim();
        const employeeId = String(item.employeeId ?? "").trim();
        const resolvedTestId = await resolveEmployeeTestId(testId, employeeId);

        if (!resolvedTestId) {
          skipped.push({
            employeeId: employeeId || undefined,
            testId: testId || undefined,
            error: "Assigned test not found",
          });
          continue;
        }

        try {
          await deleteEmployeeTestVideo(resolvedTestId);
          deleted.push(resolvedTestId);
        } catch (err: any) {
          skipped.push({
            employeeId: employeeId || undefined,
            testId: resolvedTestId,
            error: err?.message || "Delete failed",
          });
        }
      }

      if (deleted.length > 0) {
        cacheStore.invalidate("employees");
      }

      await writeLog(
        "employee",
        "ADMIN_BULK_DELETE_EMPLOYEE_TEST_VIDEOS",
        deleted.length > 0 ? "success" : "failed",
        `Bulk deleted ${deleted.length} proctoring video(s); skipped ${skipped.length}`
      );

      return NextResponse.json({
        success: deleted.length > 0,
        deletedCount: deleted.length,
        skippedCount: skipped.length,
        deletedTestIds: deleted,
        skipped,
        message:
          deleted.length > 0
            ? `${deleted.length} proctoring video(s) deleted. Test scores and status unchanged.`
            : "No proctoring videos were deleted.",
      });
    }

    const testId = String(body.testId ?? "").trim();
    const employeeId = String(body.employeeId ?? "").trim();

    if (!testId && !employeeId) {
      return NextResponse.json({ error: "testId or employeeId is required" }, { status: 400 });
    }

    const resolvedTestId = await resolveEmployeeTestId(testId, employeeId);

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
