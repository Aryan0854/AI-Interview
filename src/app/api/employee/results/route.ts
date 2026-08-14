import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { authenticateRequestAsync } from "@/lib/employee-auth";
import { localTestsDb, LocalTestsDb } from "@/services/local-tests-db";
import { allowLocalTestsFallback } from "@/lib/db-mode";
import { reconcileEmployeeTestsFromLocalJson } from "@/services/employee-test-supabase-sync";

interface ResultItem {
  id: string;
  topic_id: string;
  topic_title: string;
  subject_id: string;
  subject_title: string;
  difficulty: string;
  total_questions: number;
  correct_answers: number;
  accuracy_pct: number;
  time_taken_seconds: number;
  started_at: string | null;
  completed_at: string | null;
  topic_breakdown: unknown[];
  ai_analysis: string;
  improvement_suggestions: unknown[];
}

function round(value: number, decimals = 0) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

async function loadResultsFromSupabase(employeeId: string): Promise<ResultItem[] | null> {
  const { data: empRow, error: empErr } = await supabase
    .from("employees")
    .select("id")
    .eq("employee_id", employeeId)
    .single();

  if (empErr || !empRow) return null;

  const userUuid = (empRow as { id: string }).id;

  const { data: tests, error: testsError } = await supabase
    .from("tests")
    .select(
      "id, topic_id, subject_id, difficulty, total_questions, started_at, completed_at, in_progress, score_correct, score_percent, ai_analysis, topic_title, subject_title"
    )
    .eq("employee_id", userUuid)
    .eq("status", "completed")
    .order("completed_at", { ascending: false });

  if (testsError || !tests?.length) return null;

  const topicIds = Array.from(new Set(tests.map((test) => test.topic_id)));
  const { data: topicRows } = await supabase
    .from("learning_topics")
    .select("id, title")
    .in("id", topicIds);

  const subjectIds = Array.from(new Set(tests.map((test) => test.subject_id)));
  const { data: subjectRows } = await supabase
    .from("learning_subjects")
    .select("id, title")
    .in("id", subjectIds);

  const topicTitle = new Map((topicRows ?? []).map((topic) => [topic.id, topic.title]));
  const subjectTitle = new Map((subjectRows ?? []).map((subject) => [subject.id, subject.title]));

  const testIds = tests.map((test) => test.id);
  const { data: attempts } = await supabase
    .from("test_attempts")
    .select("test_id, question_id, is_correct")
    .in("test_id", testIds);

  const attemptsByTest = new Map<string, Array<{ question_id: string; is_correct: boolean }>>();
  (attempts ?? []).forEach((attempt) => {
    const list = attemptsByTest.get(attempt.test_id) ?? [];
    list.push(attempt);
    attemptsByTest.set(attempt.test_id, list);
  });

  return tests.map((test) => {
    const testAttempts = attemptsByTest.get(test.id) ?? [];
    const correct =
      (test as { score_correct?: number }).score_correct ??
      LocalTestsDb.scoreFromAttempts(testAttempts as any, test as any);
    const totalQs = test.total_questions || 25;
    const accuracy_pct =
      (test as { score_percent?: number }).score_percent ??
      (totalQs > 0 ? round((correct / totalQs) * 100) : 0);

    return {
      id: test.id,
      topic_id: test.topic_id,
      topic_title:
        topicTitle.get(test.topic_id) ??
        (test as { topic_title?: string }).topic_title ??
        test.topic_id,
      subject_id: test.subject_id,
      subject_title:
        subjectTitle.get(test.subject_id) ??
        (test as { subject_title?: string }).subject_title ??
        test.subject_id,
      difficulty: test.difficulty,
      total_questions: test.total_questions,
      correct_answers: correct,
      accuracy_pct,
      time_taken_seconds: 0,
      started_at: test.started_at,
      completed_at: test.completed_at,
      topic_breakdown: [],
      ai_analysis:
        (test as { ai_analysis?: string }).ai_analysis ??
        (typeof test.in_progress === "string" ? test.in_progress : ""),
      improvement_suggestions: [],
    };
  });
}

async function loadResultsFromLocal(employeeId: string): Promise<ResultItem[]> {
  const localTests = await localTestsDb.getAllTestsForEmployee(employeeId);
  const completedTests = localTests.filter((t) => t.status === "completed");
  if (completedTests.length === 0) return [];

  const allAttempts = await localTestsDb.getAllAttemptsForEmployee(employeeId);

  return completedTests.map((test) => {
    const testAttempts = allAttempts.filter((a) => a.test_id === test.id);
    const correct = LocalTestsDb.scoreFromAttempts(testAttempts, test);
    const totalQs = test.total_questions || 25;
    const accuracy_pct =
      test.score_percent ?? (totalQs > 0 ? round((correct / totalQs) * 100) : 0);

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
      completed_at: test.completed_at,
      topic_breakdown: [],
      ai_analysis:
        test.ai_analysis ??
        (typeof test.in_progress === "string" ? test.in_progress : ""),
      improvement_suggestions: [],
    };
  });
}

/**
 * GET /api/employee/results
 * All completed testResult summaries for the authenticated employee.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequestAsync(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestedEmployeeId = request.nextUrl.searchParams.get("employee_id")?.trim().toUpperCase();
  if (requestedEmployeeId && requestedEmployeeId !== auth.employee.employee_id.toUpperCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await reconcileEmployeeTestsFromLocalJson(auth.employeeId, auth.employee);

    const supabaseResults = await loadResultsFromSupabase(auth.employeeId);
    if (supabaseResults && supabaseResults.length > 0) {
      return NextResponse.json(supabaseResults);
    }

    if (allowLocalTestsFallback()) {
      const localResults = await loadResultsFromLocal(auth.employeeId);
      return NextResponse.json(localResults);
    }

    return NextResponse.json([]);
  } catch (error) {
    console.error("Failed to load employee results:", error);
    return NextResponse.json({ error: "Failed to load results" }, { status: 500 });
  }
}
