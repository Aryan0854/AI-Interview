import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { authenticateAdminRequest } from "@/lib/employee-auth";

/**
 * GET /api/admin/learning/analytics  (admin only)
 */
export async function GET(_req: NextRequest) {
  if (!authenticateAdminRequest(_req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {

    // Total employees
    const { count: totalEmp } = await supabase.from("employees").select("*", { count: "exact" });

    // Active in last 7 days
    const weekAgo = new Date(Date.now() - 7 * 8640_000).toISOString();
    const { count: active7d } = await supabase
      .from("employees")
      .select("*",     { count: "exact" })
      .gte("updated_at", weekAgo);

    // Overall average
    const { data: empRows } = await supabase.from("employees").select("ai_readiness_score");
    const scores = (empRows ?? []).map((r: any) => r.ai_readiness_score as number);
    const overallAvg = scores.length ? round(avg(scores)) : 0;

    // Department breakdown
    type DeptRow = { department: string; count: number };
    const { data: deptRows }: any = await supabase
      .from("employees")
      .select("department, ai_readiness_score");
    const deptMap: Record<string, { count: number; scores: number[] }> = {};
    (deptRows ?? []).forEach((r: any) => {
      const d = r.department ?? "general";
      if (!deptMap[d]) deptMap[d] = { count: 0, scores: [] };
      deptMap[d].count++;
      deptMap[d].scores.push(r.ai_readiness_score ?? 0);
    });

    const departmentBreakdown = Object.entries(deptMap).map(([dept, v]) => ({
      department:    dept,
      employee_count: v.count,
      avg_readiness: round(avg(v.scores)),
      tests_completed: 0, // heavier join kept for Phase-2 optimisation
    }));

    // Subject heatmap (simple version)
    const { data: subjects } = await supabase.from("learning_subjects").select("id, title").order("order_index");

    const subjectHeatmap = await Promise.all(
      (subjects ?? []).map(async (subj) => {
        const { data: topicRows } = await supabase
          .from("learning_topics")
          .select("id, title, difficulty")
          .eq("module_id", (await supabase.from("learning_modules").select("id").eq("subject_id", subj.id).limit(1)).data?.[0]?.id);

        const topics = (topicRows ?? []).map((t: any) => ({
          topic_id:           t.id,
          topic_title:        t.title,
          difficulty:         t.difficulty,
          avg_score:          0,   // requires join — kept lightweight
          attempt_count:      0,
          mastery_pct:        0,
        }));

        return { subject_id: subj.id, subject_title: subj.title, topics } as any;
      })
    );

    return NextResponse.json({
      total_employees:          totalEmp ?? 0,
      active_employees_7d:      active7d  ?? 0,
      overall_avg_score:        overallAvg,
      department_breakdown:     departmentBreakdown,
      subject_heatmap:          subjectHeatmap,
    });
  } catch (e) {
    console.error("GET /admin/learning/analytics error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function avg(nums: number[]) { return nums.reduce((a, b) => a + b, 0) / Math.max(nums.length, 1); }
function round(n: number, d = 0)  { const m = 10 ** d; return Math.round(n * m) / m; }
