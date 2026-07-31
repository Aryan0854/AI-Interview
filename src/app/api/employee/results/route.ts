import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { authenticateRequest } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import { normalizeAnalysis } from "@/lib/learning-fallback";

interface TestRow {
  id: string;
  topic_id: string;
  subject_id: string;
  difficulty: string;
  total_questions: number;
  started_at: string | null;
  completed_at: string | null;
}

interface TopicRow {
  id: string;
  title: string;
}

interface SubjectRow {
  id: string;
  title: string;
}

interface AttemptRow {
  test_id: string;
  is_correct: boolean;
}

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
  ai_analysis: any;
  improvement_suggestions: unknown[];
}

/**
 * GET /api/employee/results
 * All completed testResult summaries for the authenticated employee.
 */
export async function GET(request: NextRequest) {
  const auth = authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestedEmployeeId = request.nextUrl.searchParams.get("employee_id")?.trim().toUpperCase();
  if (requestedEmployeeId && requestedEmployeeId !== auth.employee.employee_id.toUpperCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Resolve Supabase UUID from employees table
    const { data: empRow, error: empErr } = await supabase
      .from("employees")
      .select("id")
      .eq("employee_id", auth.employeeId)
      .single();

    if (empErr || !empRow) {
      throw new Error("Employee not found in Supabase");
    }

    const userUuid = (empRow as any).id;

    // ----- tests -----
    const { data: tests, error: testsError } = await supabase
      .from("tests")
      .select("id, topic_id, subject_id, difficulty, total_questions, started_at, completed_at, in_progress")
      .eq("employee_id", userUuid)
      .eq("status", "completed")
      .order("completed_at", { ascending: false });

    if (testsError) throw testsError;

    if (!tests || tests.length === 0) {
      return NextResponse.json([]);
    }

    const topicIds = Array.from(new Set(tests.map((test) => test.topic_id)));
    const { data: topicRows, error: topicError } = await supabase
      .from("learning_topics")
      .select("id, title")
      .in("id", topicIds);

    if (topicError) throw topicError;

    const subjectIds = Array.from(new Set(tests.map((test) => test.subject_id)));
    const { data: subjectRows, error: subjectError } = await supabase
      .from("learning_subjects")
      .select("id, title")
      .in("id", subjectIds);

    if (subjectError) throw subjectError;

    const topicTitle = new Map((topicRows ?? []).map((topic) => [topic.id, topic.title]));
    const subjectTitle = new Map((subjectRows ?? []).map((subject) => [subject.id, subject.title]));

    const testIds = tests.map((test) => test.id);
    const { data: attempts, error: attemptsError } = await supabase
      .from("test_attempts")
      .select("test_id, is_correct")
      .in("test_id", testIds);

    if (attemptsError) throw attemptsError;

    const accuracyMap: Record<string, { correct: number; total: number }> = {};
    (attempts ?? []).forEach((attempt) => {
      if (!accuracyMap[attempt.test_id]) {
        accuracyMap[attempt.test_id] = { correct: 0, total: 0 };
      }
      accuracyMap[attempt.test_id].total += 1;
      if (attempt.is_correct) {
        accuracyMap[attempt.test_id].correct += 1;
      }
    });

    const results: ResultItem[] = tests.map((test) => {
      const accuracy = accuracyMap[test.id] ?? { correct: 0, total: 0 };
      const accuracy_pct = accuracy.total > 0 ? round((accuracy.correct / accuracy.total) * 100) : 0;

      return {
        id: test.id,
        topic_id: test.topic_id,
        topic_title: topicTitle.get(test.topic_id) ?? test.topic_id,
        subject_id: test.subject_id,
        subject_title: subjectTitle.get(test.subject_id) ?? test.subject_id,
        difficulty: test.difficulty,
        total_questions: test.total_questions,
        correct_answers: accuracy.correct,
        accuracy_pct,
        time_taken_seconds: 0,
        started_at: test.started_at,
        completed_at: test.completed_at,
        topic_breakdown: [],
        ai_analysis: normalizeAnalysis(test.in_progress),
        improvement_suggestions: [],
      };
    });

    return NextResponse.json(results);
  } catch (error) {
    console.warn("Supabase query failed, falling back to local JSON database:", error);

    try {
      // Fallback: load completed tests from local DB for auth.employeeId
      const localTests = await localTestsDb.getAllTestsForEmployee(auth.employeeId);
      const completedTests = localTests.filter((t) => t.status === "completed");

      if (completedTests.length === 0) {
        return NextResponse.json([]);
      }

      const allAttempts = await localTestsDb.getAllAttemptsForEmployee(auth.employeeId);

      const results: ResultItem[] = completedTests.map((test) => {
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
          completed_at: test.completed_at,
          topic_breakdown: [],
          ai_analysis: normalizeAnalysis(test.in_progress),
          improvement_suggestions: [],
        };
      });

      return NextResponse.json(results);
    } catch (fallbackError) {
      console.error("Local database fallback failed:", fallbackError);
      return NextResponse.json({ error: "Failed to load results" }, { status: 500 });
    }
  }
}

function round(value: number, decimals = 0) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
