import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { authenticateRequest } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";

/**
 * POST /api/employee/tests/:id/submit
 * Body: { answers: [{ question_id: string, selected_index: number, time_seconds: number }] }
 * Persists attempts, updates test status, and computes per-question results.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body  = await request.json();
    const answers = body.answers ?? [];
    if (!Array.isArray(answers) || answers.length === 0) {
      return NextResponse.json({ error: "Empty answers" }, { status: 400 });
    }

    let attempts: any[] = [];
    let testRow: any = null;
    let questionsList: any[] = [];
    let isLocal = false;

    try {
      // Load question→correct mapping
      const questionIds = answers.map((a: { question_id: string }) => a.question_id);
      const { data: questions, error: qErr } = await supabase
        .from("test_questions")
        .select("id, correct_option_index")
        .in("id", questionIds);
      if (qErr) throw qErr;

      const correctMap = new Map((questions ?? []).map((q) => [q.id, q.correct_option_index]));

      // ---- persist attempts ----
      attempts = answers
        .filter((a: { question_id: string; selected_index: number }) =>
          correctMap.has(a.question_id)
        )
        .map((a: { question_id: string; selected_index: number; time_seconds?: number }) => ({
          test_id:               id,
          employee_id:           auth.employeeId,
          question_id:           a.question_id,
          selected_option_index: a.selected_index,
          is_correct:            correctMap.get(a.question_id)! === a.selected_index,
          time_taken_seconds:    a.time_seconds ?? 0,
          session_key:           id.slice(0, 8),
        }));

      if (attempts.length > 0) {
        const { error: insErr } = await supabase.from("test_attempts").insert(attempts);
        if (insErr) throw insErr;
      }

      // ---- mark test completed ----
      const { error: updErr } = await supabase
        .from("tests")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", id);
      if (updErr) throw updErr;

      const { data: tRow, error: tErr } = await supabase.from("tests").select("*").eq("id", id).single();
      if (tErr) throw tErr;
      testRow = tRow;

      const { data: qList, error: qListErr } = await supabase
        .from("test_questions")
        .select("id, question_text, options, explanation, correct_option_index")
        .eq("test_id", id)
        .order("question_index");
      if (qListErr) throw qListErr;
      questionsList = qList ?? [];
    } catch (dbErr) {
      console.warn("Supabase submit failed, falling back to local database.", dbErr);
      isLocal = true;

      const localQuestions = await localTestsDb.getQuestions(id);
      questionsList = localQuestions;
      const correctMap = new Map(localQuestions.map((q) => [q.id, q.correct_option_index]));

      attempts = answers
        .filter((a: { question_id: string; selected_index: number }) =>
          correctMap.has(a.question_id)
        )
        .map((a: { question_id: string; selected_index: number; time_seconds?: number }) => ({
          test_id:               id,
          employee_id:           auth.employeeId,
          question_id:           a.question_id,
          selected_option_index: a.selected_index,
          is_correct:            correctMap.get(a.question_id)! === a.selected_index,
          time_taken_seconds:    a.time_seconds ?? 0,
          session_key:           id.slice(0, 8),
        }));

      if (attempts.length > 0) {
        await localTestsDb.insertAttempts(attempts);
      }

      testRow = await localTestsDb.updateTest(id, {
        status: "completed",
        completed_at: new Date().toISOString()
      });
    }

    // ---- compute accuracy ----
    const correct  = attempts.filter((a: any) => a.is_correct).length;
    const totalQuestions = testRow?.total_questions ?? attempts.length;
    const accuracy = round((correct / Math.max(1, totalQuestions)) * 100);

    // ---- AI analysis (Gemini) ----
    const wrongQuestions = answers
      .filter((a: any) => {
        const q = questionsList.find((qq: any) => qq.id === a.question_id);
        return q ? q.correct_option_index !== a.selected_index : true;
      })
      .map((a: any) => {
        const q = questionsList.find((qq: any) => qq.id === a.question_id);
        return q ? q.question_text : a.question_id;
      });

    let aiAnalysis = "";
    try {
      const { askGemini } = await import("@/lib/learning-ai");
      aiAnalysis = await askGemini("analyse_results", {
        topic: testRow?.topic_title ?? "Unknown",
        accuracy,
        total: attempts.length,
        correct,
        wrongQuestions: wrongQuestions.slice(0, 5),
      });

      // Save AI analysis back to database
      if (isLocal) {
        await localTestsDb.updateTest(id, { in_progress: aiAnalysis });
      } else {
        await supabase.from("tests").update({ in_progress: aiAnalysis }).eq("id", id);
      }
    } catch (aiErr) {
      console.warn("AI analysis failed or skipped:", aiErr);
    }

    return NextResponse.json({
      success: true,
      testId: id,
      total: totalQuestions,
      correct,
      accuracy,
      ai_analysis: aiAnalysis,
    });
  } catch (e) {
    console.error("submit error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function round(n: number, d = 0) {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}
