import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { supabase } from "@/lib/db";
import { localTestsDb } from "@/services/local-tests-db";

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const testId = new URL(request.url).searchParams.get("testId");
  if (!testId) {
    return NextResponse.json({ error: "testId is required" }, { status: 400 });
  }

  try {
    const { data: questions, error: qErr } = await supabase
      .from("test_questions")
      .select("id, question_index, question_text, options, correct_option_index, explanation, difficulty")
      .eq("test_id", testId)
      .order("question_index", { ascending: true });
    if (qErr) throw qErr;

    if (questions && questions.length > 0) {
      const { data: attempts } = await supabase
        .from("test_attempts")
        .select("question_id, selected_option_index, is_correct")
        .eq("test_id", testId);

      const attemptMap = new Map((attempts ?? []).map((a) => [a.question_id, a]));
      const review = questions.map((q) => {
        const attempt = attemptMap.get(q.id);
        return {
          questionIndex: q.question_index,
          questionText: q.question_text,
          options: q.options,
          correctOptionIndex: q.correct_option_index,
          explanation: q.explanation,
          difficulty: q.difficulty,
          selectedOptionIndex: attempt?.selected_option_index ?? null,
          isCorrect: attempt?.is_correct ?? null,
        };
      });
      return NextResponse.json({ questions: review });
    }
  } catch (err) {
    console.warn("Supabase test review query failed, trying local fallback:", err);
  }

  try {
    const [localQuestions, localAttempts] = await Promise.all([
      localTestsDb.getQuestions(testId),
      localTestsDb.getAttempts(testId),
    ]);
    const attemptMap = new Map(localAttempts.map((a: any) => [a.question_id, a]));
    const review = localQuestions
      .sort((a: any, b: any) => a.question_index - b.question_index)
      .map((q: any) => {
        const attempt = attemptMap.get(q.id);
        return {
          questionIndex: q.question_index,
          questionText: q.question_text,
          options: q.options,
          correctOptionIndex: q.correct_option_index,
          explanation: q.explanation,
          difficulty: q.difficulty,
          selectedOptionIndex: attempt?.selected_option_index ?? null,
          isCorrect: attempt?.is_correct ?? null,
        };
      });
    return NextResponse.json({ questions: review });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load test review" }, { status: 500 });
  }
}
