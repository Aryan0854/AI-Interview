export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isAssessmentOnlyEmployee, isProductQbEmployee, PRODUCT_ASSESSMENT_TOPIC_ID } from "@/lib/employee-auth";
import { buildLearningTopicsForEmployee } from "@/data/learning-subjects";
import { localTestsDb } from "@/services/local-tests-db";
import { supabase } from "@/lib/db";

/**
 * GET /api/employee/subjects
 * Returns learning subject cards for the employee portal home page.
 * Question Banks / auto-imported Supabase subjects are never exposed here.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const productQbEligible = isProductQbEmployee(auth.employee);
    const assessmentOnly = isAssessmentOnlyEmployee(auth.employee);

    let topics = buildLearningTopicsForEmployee({
      productQbEligible,
      product: auth.employee.product,
    });

    if (assessmentOnly) {
      topics = topics.filter((topic) => topic.id === PRODUCT_ASSESSMENT_TOPIC_ID);
    }

    if (productQbEligible) {
      const localTest = await localTestsDb.getTest(auth.employeeId, PRODUCT_ASSESSMENT_TOPIC_ID);
      const testId = localTest?.id ?? null;

      const qbIndex = topics.findIndex((topic) => topic.id === PRODUCT_ASSESSMENT_TOPIC_ID);
      if (qbIndex >= 0 && testId) {
        topics[qbIndex] = {
          ...topics[qbIndex],
          href: `/employee/tests/${testId}`,
        };
      }
    }

    return NextResponse.json(topics);
  } catch (e: any) {
    console.error("GET /api/employee/subjects error:", e);
    return NextResponse.json({ error: e.message ?? "Internal error" }, { status: 500 });
  }
}

/**
 * POST /api/employee/subjects
 * Admin-only: create a new learning_subject row.
 */
export async function POST(request: NextRequest) {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: emp } = await supabase.from("employees").select("role").eq("id", user.id).single();
    if (emp?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { title, description, icon = "BookOpen", color = "#3b82f6", order_index = 0 } = body;

    const { data, error: insErr } = await supabase
      .from("learning_subjects")
      .insert({ title, description, icon, color, order_index })
      .select()
      .single();

    if (insErr) throw insErr;
    return NextResponse.json(data);
  } catch (e: any) {
    console.error("POST /employee/subjects error:", e);
    return NextResponse.json({ error: e.message ?? "Internal error" }, { status: 500 });
  }
}
