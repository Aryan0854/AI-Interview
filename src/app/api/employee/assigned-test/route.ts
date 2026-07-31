import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync, isProductQbEmployee } from "@/lib/employee-auth";
import { getEmployeeUuid } from "@/lib/employee-test-access";
import { supabase } from "@/lib/db";

const TOPIC_ID = "resource-product-assessment";

/**
 * GET /api/employee/assigned-test
 * Returns the pre-imported product assessment for the logged-in employee.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequestAsync(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isProductQbEmployee(auth.employee)) {
      return NextResponse.json({ test: null });
    }

    const employeeUuid = await getEmployeeUuid(auth.employeeId);
    const { data, error } = await supabase
      .from("tests")
      .select("id, topic_id, topic_title, subject_id, total_questions, status, started_at, completed_at, created_at")
      .eq("employee_id", employeeUuid)
      .eq("topic_id", TOPIC_ID)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("assigned-test Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to load assigned test" }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ test: null });
    }

    if (data.status === "completed") {
      return NextResponse.json({ test: null });
    }

    return NextResponse.json({
      test_id: data.id,
      topic_title: data.topic_title ?? "Product Assessment",
      subject_title: "Product Assessment",
      total_questions: data.total_questions,
      status: data.status,
      started_at: data.started_at,
      completed_at: data.completed_at,
    });
  } catch (e) {
    console.error("GET /employee/assigned-test error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
