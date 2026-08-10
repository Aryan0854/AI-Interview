import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { authenticateRequestAsync } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import { syncSubmitToSupabase } from "@/services/employee-test-supabase-sync";
import { canSubmitTest, normalizeProctoring } from "@/lib/employee-proctoring";
import { getOwnedTest } from "@/lib/employee-test-access";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/employee/tests/:id/submit
 * Body: { answers: [{ question_id: string, selected_index: number, time_seconds: number }] }
 * Persists attempts, updates test status, computes score, and syncs to Supabase.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authenticateRequestAsync(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const answers = body.answers ?? [];
    if (!Array.isArray(answers) || answers.length === 0) {
      return NextResponse.json({ error: "Empty answers" }, { status: 400 });
    }

    const owned = await getOwnedTest(id, auth.employeeId);
    if (!owned) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }
    const localTest = owned.test;

    if (localTest.status === "completed") {
      return NextResponse.json({ error: "Test already submitted." }, { status: 409 });
    }

    const submitCheck = canSubmitTest(localTest);
    if (!submitCheck.ok && submitCheck.code === "NOT_STARTED") {
      return NextResponse.json({ error: submitCheck.error }, { status: 400 });
    }

    const localQuestions = await localTestsDb.getQuestions(id);
    const useLocal = true;

    let attempts: any[] = [];
    let testRow: any = null;
    let questionsList: any[] = useLocal ? localQuestions : [];

    if (useLocal && localTest) {
      const correctMap = new Map(
        localQuestions.map((q) => [q.id, q.correct_option_index])
      );

      attempts = answers
        .filter((a: { question_id: string }) => correctMap.has(a.question_id))
        .map(
          (a: {
            question_id: string;
            selected_index: number;
            time_seconds?: number;
          }) => ({
            test_id: id,
            employee_id: auth.employeeId,
            question_id: a.question_id,
            selected_option_index: a.selected_index,
            is_correct: correctMap.get(a.question_id)! === a.selected_index,
            time_taken_seconds: a.time_seconds ?? 0,
            session_key: id.slice(0, 8),
          })
        );

      if (attempts.length > 0) {
        await localTestsDb.deleteAttempts(id);
        await localTestsDb.insertAttempts(attempts);
      }

      testRow = localTest;
    } else {
      try {
        const questionIds = answers.map((a: { question_id: string }) => a.question_id);
        const { data: questions, error: qErr } = await supabase
          .from("test_questions")
          .select("id, correct_option_index")
          .in("id", questionIds);
        if (qErr) throw qErr;

        const correctMap = new Map(
          (questions ?? []).map((q) => [q.id, q.correct_option_index])
        );

        attempts = answers
          .filter((a: { question_id: string; selected_index: number }) =>
            correctMap.has(a.question_id)
          )
          .map(
            (a: {
              question_id: string;
              selected_index: number;
              time_seconds?: number;
            }) => ({
              test_id: id,
              employee_id: auth.employeeId,
              question_id: a.question_id,
              selected_option_index: a.selected_index,
              is_correct: correctMap.get(a.question_id)! === a.selected_index,
              time_taken_seconds: a.time_seconds ?? 0,
              session_key: id.slice(0, 8),
            })
          );

        if (attempts.length > 0) {
          await supabase.from("test_attempts").delete().eq("test_id", id);
          const { error: insErr } = await supabase.from("test_attempts").insert(attempts);
          if (insErr) throw insErr;
        }

        const { data: tRow, error: tErr } = await supabase
          .from("tests")
          .select("*")
          .eq("id", id)
          .single();
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
        if (!localTest) throw dbErr;

        const correctMap = new Map(
          localQuestions.map((q) => [q.id, q.correct_option_index])
        );
        attempts = answers
          .filter((a: { question_id: string }) => correctMap.has(a.question_id))
          .map(
            (a: {
              question_id: string;
              selected_index: number;
              time_seconds?: number;
            }) => ({
              test_id: id,
              employee_id: auth.employeeId,
              question_id: a.question_id,
              selected_option_index: a.selected_index,
              is_correct: correctMap.get(a.question_id)! === a.selected_index,
              time_taken_seconds: a.time_seconds ?? 0,
              session_key: id.slice(0, 8),
            })
          );

        if (attempts.length > 0) {
          await localTestsDb.deleteAttempts(id);
          await localTestsDb.insertAttempts(attempts);
        }
        testRow = localTest;
        questionsList = localQuestions;
      }
    }

    const correct = attempts.filter((a: any) => a.is_correct).length;
    const totalQuestions = testRow?.total_questions ?? questionsList.length ?? attempts.length;
    const accuracy = round((correct / Math.max(1, totalQuestions)) * 100);
    const completedAt = new Date().toISOString();

    const completionUpdates = {
      status: "completed" as const,
      completed_at: completedAt,
      score_correct: correct,
      score_total: totalQuestions,
      score_percent: accuracy,
      ai_analysis: null,
      proctoring: {
        ...normalizeProctoring(localTest.proctoring),
        autoSubmitted:
          normalizeProctoring(localTest.proctoring).autoSubmitted ||
          body.autoSubmitted === true,
      },
    };

    if (useLocal && localTest) {
      testRow = await localTestsDb.updateTest(id, completionUpdates);
    } else {
      const { data: updated, error: updErr } = await supabase
        .from("tests")
        .update({
          status: "completed",
          completed_at: completedAt,
          score_correct: correct,
          score_total: totalQuestions,
          score_percent: accuracy,
          ai_analysis: null,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (updErr) throw updErr;
      testRow = updated;
    }

    try {
      await syncSubmitToSupabase(
        id,
        auth.employeeId,
        attempts,
        {
          ...completionUpdates,
          topic_title: testRow?.topic_title,
          subject_title: testRow?.subject_title,
          session_recording_url: testRow?.session_recording_url,
          proctoring: testRow?.proctoring,
          started_at: testRow?.started_at,
          time_limit_seconds: testRow?.time_limit_seconds,
          total_questions: totalQuestions,
          difficulty: testRow?.difficulty,
          topic_id: testRow?.topic_id,
          subject_id: testRow?.subject_id,
          current_question_index: testRow?.current_question_index ?? 0,
        },
        auth.employee
      );
    } catch (syncErr) {
      console.error("Supabase sync after submit failed (test row may already be saved):", syncErr);
    }

    return NextResponse.json({
      success: true,
      testId: id,
      total: totalQuestions,
      correct,
      accuracy,
      ai_analysis: null,
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
