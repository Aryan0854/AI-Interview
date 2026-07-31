import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { authenticateRequest } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import { normalizeAnalysis } from "@/lib/learning-fallback";

export async function GET(request: NextRequest) {
  const auth = authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const employeeCode = auth.employee.employee_id;

  try {
    // Try Supabase first
    const { data: empRow, error: empErr } = await supabase
      .from("employees")
      .select("id, department, xp_points, streak_days, ai_readiness_score, skill_level")
      .eq("employee_id", employeeCode)
      .single();

    if (empErr || !empRow) {
      throw new Error("Employee not found in Supabase");
    }

    const userUuid = empRow.id;
    const { department, xp_points, streak_days, ai_readiness_score, skill_level } = empRow as any;

    const { count: totalTests, error: countErr } = await supabase
      .from("tests")
      .select("*", { count: "exact", head: true })
      .eq("employee_id", userUuid)
      .eq("status", "completed");
    if (countErr) throw countErr;

    const { data: att, error: attErr } = await supabase
      .from("test_attempts")
      .select("test_id, is_correct")
      .eq("employee_id", userUuid);
    if (attErr) throw attErr;
    const attempts = att ?? [];

    const correctAttempts = attempts.filter((item: any) => item.is_correct).length;
    const averageScore = attempts.length ? round((correctAttempts / attempts.length) * 100) : 0;

    const { data: ct, error: ctErr } = await supabase
      .from("tests")
      .select("id, total_questions, completed_at, subject_id, in_progress")
      .eq("employee_id", userUuid)
      .eq("status", "completed")
      .order("completed_at", { ascending: false });
    if (ctErr) throw ctErr;
    const completedTests = ct ?? [];

    const totalLearningMins = completedTests.reduce(
      (sum, test) => sum + ((test.total_questions as number) * 2),
      0
    );
    const totalLearningHours = round(totalLearningMins / 60);

    const { data: rawSubjects, error: subjErr } = await supabase
      .from("learning_subjects")
      .select("id, title")
      .eq("is_active", true)
      .order("order_index");
    if (subjErr) throw subjErr;

    const seenTitles = new Set<string>();
    const subjects = (rawSubjects ?? []).filter((s) => {
      if (seenTitles.has(s.title)) return false;
      seenTitles.add(s.title);
      return true;
    });

    const subjectBreakdown = (subjects ?? []).map((subject) => {
      const subjectTests = completedTests.filter((t: any) => t.subject_id === subject.id);
      const testIds = subjectTests.map((t: any) => t.id);

      if (testIds.length === 0) {
        return {
          subject_id: subject.id,
          subject_title: subject.title,
          average_pct: 0,
          mastery_pct: 0,
          topic_count: 0,
        };
      }

      const attemptsForSubject = attempts.filter((a: any) => testIds.includes(a.test_id));
      const correct = attemptsForSubject.filter((item: any) => item.is_correct).length;
      const average_pct = attemptsForSubject.length ? round((correct / attemptsForSubject.length) * 100) : 0;

      return {
        subject_id: subject.id,
        subject_title: subject.title,
        average_pct,
        mastery_pct: average_pct >= 80 ? testIds.length : 0,
        topic_count: testIds.length,
      };
    });

    const weeklyMap: Record<string, { tests: number; mins: number }> = {};
    completedTests.forEach((test) => {
      const date = new Date(test.completed_at as string);
      const day = date.getDay();
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - ((day + 6) % 7));
      const key = weekStart.toISOString().split("T")[0];
      if (!weeklyMap[key]) weeklyMap[key] = { tests: 0, mins: 0 };
      weeklyMap[key].tests += 1;
      weeklyMap[key].mins += ((test.total_questions as number) * 2);
    });

    const weeklyActivity = Object.entries(weeklyMap).map(([week_start, values]) => ({
      week_start,
      tests_taken: values.tests,
      hours_spent: round(values.mins / 60),
      avg_score: 0,
    }));

    const { data: rt, error: rtErr } = await supabase
      .from("tests")
      .select("id, topic_id, subject_id, difficulty, total_questions, started_at, completed_at, in_progress")
      .eq("employee_id", userUuid)
      .eq("status", "completed")
      .order("completed_at", { ascending: true })
      .limit(10);
    if (rtErr) throw rtErr;
    const recentTests = rt ?? [];

    const topicIds = Array.from(new Set(recentTests.map((t) => t.topic_id)));
    const { data: topicRows } = await supabase.from("learning_topics").select("id, title").in("id", topicIds);
    const topicTitleMap = new Map((topicRows ?? []).map((t) => [t.id, t.title]));

    const subjectIds = Array.from(new Set(recentTests.map((t) => t.subject_id)));
    const { data: subjectRows } = await supabase.from("learning_subjects").select("id, title").in("id", subjectIds);
    const subjectTitleMap = new Map((subjectRows ?? []).map((s) => [s.id, s.title]));

    const recentResults = (recentTests ?? []).map((test) => {
      const atts = attempts.filter((a: any) => a.test_id === test.id);
      const correct = atts.filter((item: any) => item.is_correct).length;
      const accuracy_pct = atts.length ? round((correct / atts.length) * 100) : 0;

      return {
        id: test.id,
        topic_id: test.topic_id,
        topic_title: topicTitleMap.get(test.topic_id) ?? test.topic_id,
        subject_id: test.subject_id,
        subject_title: subjectTitleMap.get(test.subject_id) ?? test.subject_id,
        difficulty: test.difficulty as any,
        total_questions: test.total_questions,
        correct_answers: correct,
        accuracy_pct,
        time_taken_seconds: 0,
        started_at: test.started_at,
        completed_at: test.completed_at ?? "",
        topic_breakdown: [],
        ai_analysis: normalizeAnalysis(test.in_progress),
        improvement_suggestions: [],
      };
    });

    const sorted = [...subjectBreakdown].sort((a, b) => b.average_pct - a.average_pct);
    const strongest_subject = sorted[0]?.topic_count > 0
      ? { subject_id: sorted[0].subject_id, subject_title: sorted[0].subject_title, average_pct: sorted[0].average_pct }
      : undefined;
    const weakest_subject = sorted[sorted.length - 1]?.topic_count > 0
      ? { subject_id: sorted[sorted.length - 1].subject_id, subject_title: sorted[sorted.length - 1].subject_title, average_pct: sorted[sorted.length - 1].average_pct }
      : undefined;

    return NextResponse.json({
      total_tests_taken: totalTests ?? 0,
      average_score: averageScore,
      total_learning_hours: totalLearningHours,
      ai_readiness_score: ai_readiness_score,
      skill_level: skill_level,
      strongest_subject,
      weakest_subject,
      score_history: recentResults.map((item) => ({ date: item.completed_at, score: item.accuracy_pct })),
      subject_breakdown: subjectBreakdown,
      weekly_activity: weeklyActivity,
      recent_attempts: recentResults,
    });

  } catch (error) {
    console.warn("Supabase analytics failed, falling back to local JSON database:", error);

    try {
      const localEmp = auth.employee;
      const userUuid = employeeCode;
      
      const localTests = await localTestsDb.getAllTestsForEmployee(userUuid);
      const completedTests = localTests.filter((t) => t.status === "completed");
      const totalTests = completedTests.length;
      
      const allAttempts = await localTestsDb.getAllAttemptsForEmployee(userUuid);
      
      const correctAttempts = allAttempts.filter((a) => a.is_correct).length;
      const averageScore = allAttempts.length > 0 ? round((correctAttempts / allAttempts.length) * 100) : 0;
      
      const totalLearningMins = completedTests.reduce((sum, test) => sum + (test.total_questions * 2), 0);
      const totalLearningHours = round(totalLearningMins / 60);

      const ai_readiness_score = averageScore > 0 ? averageScore : (localEmp.ai_readiness_score || 0);
      const skill_level = ai_readiness_score >= 80 ? "advanced" : ai_readiness_score >= 60 ? "intermediate" : "beginner";

      const subjects = [
        { id: "2", title: "AI / ML" },
        { id: "3", title: "Data" },
        { id: "8", title: "Python" },
        { id: "9", title: "SQL" },
        { id: "10", title: "Cloud" },
        { id: "11", title: "MLOps" }
      ];

      const subjectBreakdown = subjects.map((subject) => {
        const testIds = completedTests.filter((t) => t.subject_id === String(subject.id)).map((t) => t.id);
        if (testIds.length === 0) {
          return {
            subject_id: subject.id,
            subject_title: subject.title,
            average_pct: 0,
            mastery_pct: 0,
            topic_count: 0,
          };
        }

        const attemptsForSub = allAttempts.filter((a) => testIds.includes(a.test_id));
        const correct = attemptsForSub.filter((a) => a.is_correct).length;
        const average_pct = attemptsForSub.length > 0 ? round((correct / attemptsForSub.length) * 100) : 0;

        return {
          subject_id: subject.id,
          subject_title: subject.title,
          average_pct,
          mastery_pct: average_pct >= 80 ? testIds.length : 0,
          topic_count: testIds.length,
        };
      });

      const weeklyMap: Record<string, { tests: number; mins: number }> = {};
      completedTests.forEach((test) => {
        const date = new Date(test.completed_at || test.created_at);
        const day = date.getDay();
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - ((day + 6) % 7));
        const key = weekStart.toISOString().split("T")[0];
        if (!weeklyMap[key]) weeklyMap[key] = { tests: 0, mins: 0 };
        weeklyMap[key].tests += 1;
        weeklyMap[key].mins += (test.total_questions * 2);
      });

      const weeklyActivity = Object.entries(weeklyMap).map(([week_start, values]) => ({
        week_start,
        tests_taken: values.tests,
        hours_spent: round(values.mins / 60),
        avg_score: 0,
      }));

      const sortedCompleted = [...completedTests]
        .sort((a, b) => new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime())
        .slice(0, 10);

      const recentResults = sortedCompleted.map((test) => {
        const testAttempts = allAttempts.filter((a) => a.test_id === test.id);
        const correct = testAttempts.filter((a) => a.is_correct).length;
        const accuracy_pct = testAttempts.length > 0 ? round((correct / testAttempts.length) * 100) : 0;

        return {
          id: test.id,
          topic_id: test.topic_id,
          topic_title: test.topic_title || test.topic_id,
          subject_id: test.subject_id,
          subject_title: test.subject_title || test.subject_id,
          difficulty: test.difficulty,
          total_questions: test.total_questions,
          correct_answers: correct,
          accuracy_pct,
          time_taken_seconds: 0,
          started_at: test.started_at,
          completed_at: test.completed_at || "",
          topic_breakdown: [],
          ai_analysis: normalizeAnalysis(test.in_progress),
          improvement_suggestions: [],
        };
      });

      const sorted = [...subjectBreakdown].sort((a, b) => b.average_pct - a.average_pct);
      const strongest_subject = sorted[0]?.topic_count > 0
        ? { subject_id: sorted[0].subject_id, subject_title: sorted[0].subject_title, average_pct: sorted[0].average_pct }
        : undefined;
      const weakest_subject = sorted[sorted.length - 1]?.topic_count > 0
        ? { subject_id: sorted[sorted.length - 1].subject_id, subject_title: sorted[sorted.length - 1].subject_title, average_pct: sorted[sorted.length - 1].average_pct }
        : undefined;

      return NextResponse.json({
        total_tests_taken: totalTests,
        average_score: averageScore,
        total_learning_hours: totalLearningHours,
        ai_readiness_score: ai_readiness_score,
        skill_level: skill_level,
        strongest_subject,
        weakest_subject,
        score_history: recentResults.map((item) => ({ date: item.completed_at, score: item.accuracy_pct })),
        subject_breakdown: subjectBreakdown,
        weekly_activity: weeklyActivity,
        recent_attempts: recentResults,
      });
    } catch (fallbackError) {
      console.error("Local database analytics fallback failed:", fallbackError);
      return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 });
    }
  }
}

function round(n: number, d = 0) {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}
