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
    const { data: rawSubjects } = await supabase.from("learning_subjects").select("id, title").order("order_index");
    const seenSubjectTitles = new Set<string>();
    const subjects = (rawSubjects ?? []).filter((s) => {
      if (seenSubjectTitles.has(s.title)) return false;
      seenSubjectTitles.add(s.title);
      return true;
    });

    const subjectIds = subjects.map((s) => s.id);
    const { data: modules } = await supabase.from("learning_modules").select("id, subject_id").in("subject_id", subjectIds);
    const moduleIds = (modules ?? []).map((m) => m.id);
    const { data: topics } = await supabase.from("learning_topics").select("id, module_id, title, difficulty").in("module_id", moduleIds);
    const topicIds = (topics ?? []).map((t) => t.id);

    const { data: topicTests } = await supabase.from("tests").select("id, topic_id, status").in("topic_id", topicIds);
    const testIds = (topicTests ?? []).map((t) => t.id);
    const { data: topicAttempts } = await supabase.from("test_attempts").select("test_id, is_correct").in("test_id", testIds);

    const attemptsByTest = new Map<string, { correct: number; total: number }>();
    (topicAttempts ?? []).forEach((a) => {
      const e = attemptsByTest.get(a.test_id) || { correct: 0, total: 0 };
      e.total += 1;
      if (a.is_correct) e.correct += 1;
      attemptsByTest.set(a.test_id, e);
    });

    const statsByTopic = new Map<string, { scores: number[]; attempts: number }>();
    (topicTests ?? []).filter((t) => t.status === "completed").forEach((t) => {
      const a = attemptsByTest.get(t.id);
      const e = statsByTopic.get(t.topic_id) || { scores: [], attempts: 0 };
      e.attempts += 1;
      if (a && a.total > 0) e.scores.push(Math.round((a.correct / a.total) * 100));
      statsByTopic.set(t.topic_id, e);
    });

    const moduleToSubject = new Map((modules ?? []).map((m) => [m.id, m.subject_id]));
    const topicsBySubject = new Map<string, any[]>();
    (topics ?? []).forEach((t) => {
      const subjId = moduleToSubject.get(t.module_id);
      if (!subjId) return;
      const stats = statsByTopic.get(t.id);
      const avgScore = stats && stats.scores.length > 0 ? Math.round(stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length) : 0;
      const list = topicsBySubject.get(subjId) || [];
      list.push({
        topic_id: t.id,
        topic_title: t.title,
        difficulty: t.difficulty,
        avg_score: avgScore,
        attempt_count: stats?.attempts ?? 0,
        mastery_pct: avgScore >= 80 ? 100 : 0,
      });
      topicsBySubject.set(subjId, list);
    });

    const subjectHeatmap = subjects.map((subj) => ({
      subject_id: subj.id,
      subject_title: subj.title,
      topics: topicsBySubject.get(subj.id) ?? [],
    }));

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
