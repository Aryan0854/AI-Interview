import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { authenticateRequest, isAssessmentOnlyEmployee, isProductQbEmployee, PRODUCT_ASSESSMENT_TOPIC_ID } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import { writeLog } from "@/lib/structured-logger";
import { syncLocalTestStateToSupabase, syncQuestionsToSupabase } from "@/services/employee-test-supabase-sync";
import { useSupabasePrimary } from "@/lib/db-mode";
import { employeeTestVideoExists } from "@/lib/employee-test-video";
import { formatTopicTitleForDisplay } from "@/lib/product-display-name";

import { fetchQuestionsFromAI, mapDifficulty } from "@/lib/learning-fallback";
import {
  canPatchTestProgress,
  markProctorSessionStarted,
  normalizeProctoring,
} from "@/lib/employee-proctoring";

async function getEmployeeUuid(employeeId: string): Promise<string> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeId);
  if (isUuid) return employeeId;
  try {
    const { data } = await supabase
      .from("employees")
      .select("id")
      .eq("employee_id", employeeId)
      .maybeSingle();
    if (data?.id) return data.id;
  } catch {}
  return employeeId;
}

function normalizeEmployeeId(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function employeeOwnsTest(test: { employee_id?: string | null }, employeeId: string, employeeUuid: string): boolean {
  const testOwner = normalizeEmployeeId(test.employee_id);
  return testOwner === normalizeEmployeeId(employeeId) || testOwner === normalizeEmployeeId(employeeUuid);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = authenticateRequest(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const employeeUuid = await getEmployeeUuid(auth.employeeId);

    let testRow: any = null;
    let questions: any[] = [];

    if (useSupabasePrimary()) {
      try {
        const { data, error } = await supabase
          .from("tests")
          .select("*")
          .eq("id", id)
          .eq("employee_id", employeeUuid)
          .single();

        if (error || !data) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        testRow = data;

        const { data: qData } = await supabase
          .from("test_questions")
          .select("*")
          .eq("test_id", id)
          .order("question_index");
        questions = qData ?? [];
      } catch (dbErr) {
        console.error("Supabase load failed:", dbErr);
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    } else {
    const localTest = await localTestsDb.getTestById(id);
    if (localTest && employeeOwnsTest(localTest, auth.employeeId, employeeUuid)) {
      testRow = localTest;
      questions = await localTestsDb.getQuestions(id);
    } else {
      try {
        const { data, error } = await supabase
          .from("tests")
          .select("*")
          .eq("id", id)
          .eq("employee_id", employeeUuid)
          .single();

        if (error || !data) {
          throw error || new Error("Test not found in Supabase");
        }
        testRow = data;

        const { data: qData } = await supabase
          .from("test_questions")
          .select("*")
          .eq("test_id", id)
          .order("question_index");
        questions = qData ?? [];
      } catch (dbErr) {
        console.warn("Supabase load failed. Falling back to local file-based database.", dbErr);
        if (!localTest || !employeeOwnsTest(localTest, auth.employeeId, employeeUuid)) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        testRow = localTest;
        questions = await localTestsDb.getQuestions(id);
      }
    }
    }

    if (
      testRow.topic_id === PRODUCT_ASSESSMENT_TOPIC_ID &&
      !isProductQbEmployee(auth.employee)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (
      isAssessmentOnlyEmployee(auth.employee) &&
      testRow.topic_id !== PRODUCT_ASSESSMENT_TOPIC_ID
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (questions.length === 0) {
      const localQuestions = await localTestsDb.getQuestions(id);
      if (localQuestions.length > 0) {
        questions = localQuestions;
        try {
          await syncQuestionsToSupabase(localQuestions);
        } catch (syncErr) {
          console.warn("Failed to sync missing test questions to Supabase:", syncErr);
        }
      }
    }

    if (questions.length === 0) {
      return NextResponse.json(
        { error: "This assessment has no questions assigned yet. Please contact your administrator." },
        { status: 400 }
      );
    }

    const has_recording = await employeeTestVideoExists(id);
    return NextResponse.json({
      test: {
        ...testRow,
        topic_title: formatTopicTitleForDisplay(testRow.topic_title),
      },
      questions,
      has_recording,
    });
  } catch (e) {
    console.error("GET /employee/tests/[id] error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = authenticateRequest(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const { in_progress, current_question_index, status, started_at } = body;

    const employeeUuid = await getEmployeeUuid(auth.employeeId);

    const localTest = await localTestsDb.getTestById(id);
    const existingTest =
      localTest && employeeOwnsTest(localTest, auth.employeeId, employeeUuid)
        ? localTest
        : null;

    if (!existingTest) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }

    const patchCheck = canPatchTestProgress(existingTest, { status, started_at });
    if (!patchCheck.ok) {
      return NextResponse.json({ error: patchCheck.error }, { status: 409 });
    }

    const updates: Record<string, unknown> = {};
    if (in_progress !== undefined) updates.in_progress = in_progress;
    if (current_question_index !== undefined) updates.current_question_index = current_question_index;
    if (status !== undefined) updates.status = status;
    if (started_at !== undefined) updates.started_at = started_at;

    if (status === "in_progress" && started_at) {
      const proctoring = markProctorSessionStarted(normalizeProctoring(existingTest.proctoring));
      updates.proctoring = proctoring;
    }

    const updated = await localTestsDb.updateTest(id, updates);
    try {
      await syncLocalTestStateToSupabase(id, auth.employee);
    } catch (syncErr) {
      console.warn("Failed to sync test progress to Supabase:", syncErr);
    }
    return NextResponse.json({ success: true, data: updated });
  } catch (e: any) {
    console.error("PATCH /employee/tests/[id] error:", e);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const employeeUuid = await getEmployeeUuid(auth.employeeId);

  try {

    // Load the test details first
    let testRow: any = null;
    let usingLocal = false;

    try {
      const { data, error } = await supabase
        .from("tests")
        .select("*")
        .eq("id", id)
        .eq("employee_id", employeeUuid)
        .single();

      if (error || !data) {
        throw error || new Error("Test not found in Supabase");
      }
      testRow = data;
    } catch (dbErr) {
      console.warn("Supabase load failed. Falling back to local file-based database for DELETE.", dbErr);
      const localTest = await localTestsDb.getTestById(id);
      if (!localTest || localTest.employee_id !== auth.employeeId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      testRow = localTest;
      usingLocal = true;
    }

    const { topic_id, topic_title, subject_title, difficulty } = testRow;
    const defDiff = difficulty || "medium";
    const startedAt = new Date().toISOString();

    if (!usingLocal) {
      try {
        // Reset the test row
        const { error: tErr } = await supabase
          .from("tests")
          .update({
            status: "pending",
            in_progress: null,
            current_question_index: 0,
            started_at: startedAt,
            completed_at: null,
            total_questions: 10
          })
          .eq("id", id)
          .eq("employee_id", employeeUuid);
        if (tErr) throw tErr;

        // Delete attempts
        const { error: aErr } = await supabase
          .from("test_attempts")
          .delete()
          .eq("test_id", id);
        if (aErr) throw aErr;

        // Delete old questions
        const { error: qDelErr } = await supabase
          .from("test_questions")
          .delete()
          .eq("test_id", id);
        if (qDelErr) throw qDelErr;

        // Fetch fresh questions
        const generated = await fetchQuestionsFromAI(subject_title || "", topic_title || topic_id, defDiff);
        const mappedQuestions = generated.map((q: any, i: number) => ({
          test_id: id,
          question_index: i,
          question_text: q.question,
          options: q.options,
          correct_option_index: q.correctIndex !== undefined ? q.correctIndex : (q.correct_option_index !== undefined ? q.correct_option_index : 0),
          explanation: q.explanation || "",
          difficulty: mapDifficulty(q.difficulty || defDiff),
          topic_id,
          topic_title: topic_title || topic_id,
        }));

        const { error: qInsErr } = await supabase.from("test_questions").insert(mappedQuestions);
        if (qInsErr) throw qInsErr;
      } catch (err) {
        console.warn("Supabase DELETE reset failed, falling back to local.", err);
        usingLocal = true;
      }
    }

    if (usingLocal) {
      await localTestsDb.updateTest(id, {
        status: "pending",
        in_progress: null,
        current_question_index: 0,
        started_at: startedAt,
        completed_at: null,
        total_questions: 10
      });
      await localTestsDb.deleteAttempts(id);
      await localTestsDb.deleteQuestions(id);

      const generated = await fetchQuestionsFromAI(subject_title || "", topic_title || topic_id, defDiff);
      const mappedQuestions = generated.map((q: any, i: number) => ({
        test_id: id,
        question_index: i,
        question_text: q.question,
        options: q.options,
        correct_option_index: q.correctIndex !== undefined ? q.correctIndex : (q.correct_option_index !== undefined ? q.correct_option_index : 0),
        explanation: q.explanation || "",
        difficulty: mapDifficulty(q.difficulty || defDiff),
        topic_id,
        topic_title: topic_title || topic_id,
      }));
      await localTestsDb.insertQuestions(mappedQuestions);
    }

    await writeLog('employee', 'RESET_EMPLOYEE_TEST', 'success', `Successfully reset employee learning test ID ${id} for employee ${auth?.employeeId || 'unknown'}`);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("DELETE /employee/tests/[id] error:", e);
    await writeLog('employee', 'RESET_EMPLOYEE_TEST_FAILED', 'failed', `Failed to reset learning test ID ${id} for employee ${auth?.employeeId || 'unknown'}: ${e.message}`);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}
