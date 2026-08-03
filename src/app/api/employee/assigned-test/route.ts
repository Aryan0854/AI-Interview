import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync, isProductQbEmployee } from "@/lib/employee-auth";
import { getEmployeeUuid } from "@/lib/employee-test-access";
import { supabase } from "@/lib/db";
import { reconcileEmployeeTestsFromLocalJson } from "@/services/employee-test-supabase-sync";
import { employeeTestVideoExists } from "@/lib/employee-test-video";

const TOPIC_ID = "resource-product-assessment";

function mapCompletedTest(row: {
  id: string;
  topic_title?: string | null;
  total_questions?: number | null;
  score_correct?: number | null;
  score_percent?: number | null;
    completed_at?: string | null;
    recording_missing?: boolean;
}) {
  const total = row.total_questions ?? 25;
  const correct = row.score_correct ?? 0;
  const scorePercent =
    row.score_percent ??
    (total > 0 ? Math.round((correct / total) * 100) : 0);

  return {
    test_id: row.id,
    topic_title: row.topic_title ?? "Product Assessment",
    total_questions: total,
    score_correct: correct,
    score_percent: scorePercent,
    completed_at: row.completed_at,
    can_retake: false,
    recording_missing: row.recording_missing ?? false,
  };
}

/**
 * GET /api/employee/assigned-test
 * Returns active (pending/in_progress) and/or latest completed product assessment.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequestAsync(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isProductQbEmployee(auth.employee)) {
      return NextResponse.json({ active_test: null, completed_test: null });
    }

    await reconcileEmployeeTestsFromLocalJson(auth.employeeId, auth.employee);

    const employeeUuid = await getEmployeeUuid(auth.employeeId);

    const { data: completedRow } = await supabase
      .from("tests")
      .select(
        "id, topic_title, total_questions, score_correct, score_percent, completed_at, status"
      )
      .eq("employee_id", employeeUuid)
      .eq("topic_id", TOPIC_ID)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: activeRow, error } = await supabase
      .from("tests")
      .select(
        "id, topic_id, topic_title, subject_id, total_questions, status, started_at, completed_at, created_at"
      )
      .eq("employee_id", employeeUuid)
      .eq("topic_id", TOPIC_ID)
      .in("status", ["pending", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("assigned-test Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to load assigned test" }, { status: 500 });
    }

    const completed_test = completedRow
      ? mapCompletedTest({
          ...completedRow,
          recording_missing: !(await employeeTestVideoExists(completedRow.id)),
        })
      : null;

    if (!activeRow) {
      return NextResponse.json({ active_test: null, completed_test });
    }

    return NextResponse.json({
      active_test: {
        test_id: activeRow.id,
        topic_title: activeRow.topic_title ?? "Product Assessment",
        subject_title: "Product Assessment",
        total_questions: activeRow.total_questions,
        status: activeRow.status,
        started_at: activeRow.started_at,
        completed_at: activeRow.completed_at,
      },
      completed_test,
    });
  } catch (e) {
    console.error("GET /employee/assigned-test error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
