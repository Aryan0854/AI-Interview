import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isProductQbEmployee } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import { supabase } from "@/lib/db";

async function getEmployeeUuid(employeeId: string): Promise<string> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeId);
  if (isUuid) return employeeId;

  try {
    const { data } = await supabase
      .from("employees")
      .select("id")
      .eq("employee_id", employeeId)
      .maybeSingle();
    if (data?.id) return data.id;
  } catch {
    // fall through
  }
  return employeeId;
}

/**
 * GET /api/employee/assigned-test
 * Returns the pre-imported product assessment for the logged-in employee.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isProductQbEmployee(auth.employee)) {
      return NextResponse.json({ test: null });
    }

    const topicId = "resource-product-assessment";

    try {
      const employeeUuid = await getEmployeeUuid(auth.employeeId);
      const { data, error } = await supabase
        .from("tests")
        .select("id, topic_id, topic_title, subject_id, total_questions, status, started_at, completed_at, created_at")
        .eq("employee_id", employeeUuid)
        .eq("topic_id", topicId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
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
      }
    } catch (dbErr) {
      console.warn("Supabase assigned-test lookup failed, using local fallback:", dbErr);
    }

    const localTest = await localTestsDb.getTest(auth.employeeId, topicId);
    if (!localTest) {
      return NextResponse.json({ test: null });
    }

    if (localTest.status === "completed") {
      return NextResponse.json({ test: null });
    }

    return NextResponse.json({
      test_id: localTest.id,
      topic_title: localTest.topic_title ?? "Product Assessment",
      subject_title: localTest.subject_title ?? "Product Assessment",
      total_questions: localTest.total_questions,
      status: localTest.status,
      started_at: localTest.started_at,
      completed_at: localTest.completed_at,
    });
  } catch (e) {
    console.error("GET /employee/assigned-test error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
