import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import {
  authenticateRequest,
  isAssessmentOnlyEmployee,
  isProductQbEmployee,
  PRODUCT_ASSESSMENT_TOPIC_ID,
} from "@/lib/employee-auth";
import { buildPortalCatalogFromSubjects, buildLearningTopicsForEmployee } from "@/data/learning-subjects";

/**
 * GET /api/employee/catalog
 * Returns learning subjects for topic drill-down.
 * Non-QB employees never receive Supabase "Question Banks" or duplicate DB subjects.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json([]);
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

    const catalog = topics.map((subject) => {
      if (subject.id === PRODUCT_ASSESSMENT_TOPIC_ID) {
        return {
          id: subject.id,
          title: subject.title,
          description: subject.description,
          icon: subject.icon,
          color: subject.color,
          is_active: true,
          modules: [
            {
              id: `${subject.id}-core`,
              subject_id: subject.id,
              title: "Assigned Assessment",
              description: subject.description,
              order_index: 1,
              topics: [
                {
                  id: `${subject.id}-test`,
                  module_id: `${subject.id}-core`,
                  title: subject.title,
                  difficulty: "medium",
                  order_index: 1,
                  estimated_minutes: 25,
                },
              ],
            },
          ],
        };
      }

      const base = buildPortalCatalogFromSubjects().find((item) => item.id === subject.id);
      return base ?? {
        id: subject.id,
        title: subject.title,
        description: subject.description,
        icon: subject.icon,
        color: subject.color,
        is_active: true,
        modules: [],
      };
    });

    // Resolve employee UUID only when needed for future per-employee stats.
    try {
      await supabase
        .from("employees")
        .select("id, role")
        .eq("employee_id", auth.employeeId)
        .maybeSingle();
    } catch {
      // ignore lookup failures
    }

    return NextResponse.json(catalog);
  } catch (e) {
    console.error("GET /employee/catalog error:", e);
    return NextResponse.json(buildPortalCatalogFromSubjects());
  }
}
