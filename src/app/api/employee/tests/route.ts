import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { authenticateRequestAsync } from "@/lib/employee-auth";
import { getEmployeeUuid } from "@/lib/employee-test-access";
import { formatTopicTitleForDisplay } from "@/lib/product-display-name";

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequestAsync(request);
    if (!auth) {
      return NextResponse.json([]);
    }

    const employeeUuid = await getEmployeeUuid(auth.employeeId);
    const { data } = await supabase
      .from("tests")
      .select("id, topic_id, subject_id, difficulty, total_questions, status, started_at, completed_at, topic_title, subject_title, score_correct, score_percent")
      .eq("employee_id", employeeUuid)
      .order("started_at", { ascending: false })
      .limit(10);

    return NextResponse.json(
      (data ?? []).map((test) => ({
        ...test,
        topic_title: formatTopicTitleForDisplay(test.topic_title),
      }))
    );
  } catch (e) {
    console.error("GET /employee/tests error:", e);
    return NextResponse.json([]);
  }
}
