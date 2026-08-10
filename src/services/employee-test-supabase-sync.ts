import { supabase } from "@/lib/db";
import { useSupabasePrimary } from "@/lib/db-mode";
import type { EmployeeAccount } from "@/lib/employee-auth";
import { readPersistedJson, writePersistedJson } from "@/lib/runtime-data";
import {
  localTestsDb,
  type LocalTest,
  type LocalTestAttempt,
  type LocalTestQuestion,
} from "@/services/local-tests-db";

type AttemptInput = {
  test_id: string;
  employee_id: string;
  question_id: string;
  selected_option_index: number;
  is_correct: boolean;
  time_taken_seconds: number;
  session_key: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function resolveEmployeeUuid(
  employeeCode: string,
  profile?: Partial<EmployeeAccount>
): Promise<string> {
  const code = String(employeeCode ?? "").trim();
  if (!code) throw new Error("Employee code is required");

  if (isUuid(code)) {
    const { data } = await supabase.from("employees").select("id").eq("id", code).maybeSingle();
    if (data?.id) return data.id;
  }

  const { data: existing } = await supabase
    .from("employees")
    .select("id")
    .eq("employee_id", code)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: inserted, error } = await supabase
    .from("employees")
    .upsert(
      {
        employee_id: code,
        email: profile?.email || `${code}@nokia.com`,
        full_name: profile?.full_name || code,
        department: "general",
        role: profile?.role || "employee",
        product: profile?.product || null,
        is_first_login: profile?.is_first_login ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id" }
    )
    .select("id")
    .single();

  if (error || !inserted?.id) {
    throw error || new Error(`Failed to upsert employee ${code}`);
  }
  return inserted.id;
}

/** Full test row for Postgres upsert (matches full-schema-and-seed.sql). */
export function buildTestRow(test: LocalTest, employeeUuid: string): Record<string, unknown> {
  const aiAnalysis =
    test.ai_analysis ??
    (typeof test.in_progress === "string" ? test.in_progress : null);

  let inProgress: unknown = test.in_progress;
  if (typeof inProgress === "object" && inProgress !== null) {
    inProgress = inProgress;
  } else if (typeof inProgress === "string") {
    try {
      inProgress = JSON.parse(inProgress);
    } catch {
      inProgress = null;
    }
  } else {
    inProgress = null;
  }

  return {
    id: test.id,
    employee_id: employeeUuid,
    employee_code: test.employee_id,
    topic_id: test.topic_id,
    subject_id: test.subject_id,
    topic_title: test.topic_title ?? null,
    subject_title: test.subject_title ?? null,
    difficulty: String(test.difficulty ?? "medium"),
    total_questions: test.total_questions,
    time_limit_seconds: test.time_limit_seconds,
    status: test.status,
    current_question_index: test.current_question_index,
    started_at: test.started_at,
    completed_at: test.completed_at,
    in_progress: inProgress,
    session_recording_url: test.session_recording_url ?? null,
    proctoring: test.proctoring ?? null,
    score_correct: test.score_correct ?? null,
    score_total: test.score_total ?? null,
    score_percent: test.score_percent ?? null,
    ai_analysis: aiAnalysis,
  };
}

export async function syncQuestionsToSupabase(
  questions: LocalTestQuestion[]
): Promise<void> {
  if (questions.length === 0) return;

  const payload = questions.map((q) => ({
    id: q.id,
    test_id: q.test_id,
    question_index: q.question_index,
    question_text: q.question_text,
    options: q.options,
    correct_option_index: q.correct_option_index,
    explanation: q.explanation ?? "",
    difficulty: q.difficulty,
    topic_id: q.topic_id,
    topic_title: q.topic_title ?? "",
  }));

  const { error } = await supabase
    .from("test_questions")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
}

export async function syncAttemptsToSupabase(
  testId: string,
  employeeUuid: string,
  attempts: AttemptInput[],
  replaceExisting = true
): Promise<void> {
  if (replaceExisting) {
    const { error: delErr } = await supabase.from("test_attempts").delete().eq("test_id", testId);
    if (delErr) throw delErr;
  }

  if (attempts.length === 0) return;

  const payload = attempts.map((a) => ({
    test_id: testId,
    employee_id: employeeUuid,
    question_id: a.question_id,
    selected_option_index: a.selected_option_index,
    is_correct: a.is_correct,
    time_taken_seconds: a.time_taken_seconds,
    session_key: a.session_key,
  }));

  const { error } = await supabase.from("test_attempts").insert(payload);
  if (error) throw error;
}

export async function syncTestToSupabase(
  test: LocalTest,
  employeeUuid: string,
  questions?: LocalTestQuestion[]
): Promise<void> {
  const row = buildTestRow(test, employeeUuid);
  const { error } = await supabase.from("tests").upsert(row, { onConflict: "id" });
  if (error) throw error;

  if (questions && questions.length > 0) {
    await syncQuestionsToSupabase(questions);
  }
}

export async function syncProductTestBundle(
  testId: string,
  profile?: Partial<EmployeeAccount>
): Promise<{ employeeUuid: string; test: LocalTest; questions: LocalTestQuestion[] } | null> {
  const test = await localTestsDb.getTestById(testId);
  if (!test) return null;

  const questions = await localTestsDb.getQuestions(testId);
  const employeeUuid = await resolveEmployeeUuid(test.employee_id, profile);
  await syncTestToSupabase(test, employeeUuid, questions);

  return { employeeUuid, test, questions };
}

export async function syncLocalTestStateToSupabase(
  testId: string,
  profile?: Partial<EmployeeAccount>
): Promise<void> {
  const bundle = await syncProductTestBundle(testId, profile);
  if (!bundle) {
    if (useSupabasePrimary()) {
      throw new Error(`Test ${testId} not found — cannot sync to Supabase`);
    }
  }
}

/** Push completed tests from local JSON into Supabase when hosted DB is behind (e.g. after local submit). */
export async function reconcileEmployeeTestsFromLocalJson(
  employeeCode: string,
  profile?: Partial<EmployeeAccount>
): Promise<void> {
  try {
    const raw = await readPersistedJson("local_tests_db.json");
    if (!raw) return;

    const db = JSON.parse(raw) as {
      tests: LocalTest[];
      test_questions: LocalTestQuestion[];
      test_attempts: LocalTestAttempt[];
    };

    const code = String(employeeCode ?? "").trim();
    const localCompleted = (db.tests ?? []).filter(
      (t) => t.employee_id === code && t.status === "completed"
    );
    if (!localCompleted.length) return;

    const employeeUuid = await resolveEmployeeUuid(code, profile);

    for (const test of localCompleted) {
      const { data: remote } = await supabase
        .from("tests")
        .select("status")
        .eq("id", test.id)
        .maybeSingle();

      if (remote?.status === "completed") continue;
      // Never overwrite an admin reset (remote pending) with stale local completed rows.
      if (remote?.status === "pending" && test.status === "completed") continue;

      const questions = (db.test_questions ?? []).filter((q) => q.test_id === test.id);
      await syncTestToSupabase(test, employeeUuid, questions);

      const attempts = (db.test_attempts ?? []).filter((a) => a.test_id === test.id);
      if (attempts.length > 0) {
        await syncAttemptsToSupabase(
          test.id,
          employeeUuid,
          attempts.map((a) => ({
            test_id: a.test_id,
            employee_id: a.employee_id,
            question_id: a.question_id,
            selected_option_index: a.selected_option_index,
            is_correct: a.is_correct,
            time_taken_seconds: a.time_taken_seconds,
            session_key: a.session_key,
          })),
          true
        );
      }
    }
  } catch (err) {
    console.warn("reconcileEmployeeTestsFromLocalJson failed:", err);
  }
}

/** Clear stale completed state from local JSON so dashboard sync cannot undo admin reset. */
export async function clearLocalTestSnapshotAfterReset(testId: string): Promise<void> {
  try {
    const raw = await readPersistedJson("local_tests_db.json");
    if (!raw) return;

    const db = JSON.parse(raw) as {
      tests: LocalTest[];
      test_questions: LocalTestQuestion[];
      test_attempts: LocalTestAttempt[];
    };

    let changed = false;
    db.tests = (db.tests ?? []).map((t) => {
      if (t.id !== testId) return t;
      changed = true;
      return {
        ...t,
        status: "pending" as const,
        in_progress: null,
        current_question_index: 0,
        started_at: null,
        completed_at: null,
        session_recording_url: undefined,
        proctoring: undefined,
        score_correct: null,
        score_total: null,
        score_percent: null,
        ai_analysis: null,
      };
    });

    const beforeAttempts = (db.test_attempts ?? []).length;
    db.test_attempts = (db.test_attempts ?? []).filter((a) => a.test_id !== testId);
    if (db.test_attempts.length !== beforeAttempts) changed = true;

    if (changed) {
      await writePersistedJson("local_tests_db.json", JSON.stringify(db, null, 2));
    }
  } catch (err) {
    console.warn("clearLocalTestSnapshotAfterReset failed:", err);
  }
}

export async function syncSubmitToSupabase(
  testId: string,
  employeeCode: string,
  attempts: AttemptInput[],
  updates: Partial<LocalTest>,
  profile?: Partial<EmployeeAccount>
): Promise<void> {
  const test = await localTestsDb.getTestById(testId);
  if (!test) throw new Error("Test not found");

  const merged: LocalTest = { ...test, ...updates };
  const questions = await localTestsDb.getQuestions(testId);
  const employeeUuid = await resolveEmployeeUuid(employeeCode, profile);

  await syncTestToSupabase(merged, employeeUuid, questions);
  await syncAttemptsToSupabase(testId, employeeUuid, attempts, true);
}

/** Reset a test row in Postgres (admin reset). */
export async function resetTestInSupabase(testId: string): Promise<void> {
  const { error: attErr } = await supabase.from("test_attempts").delete().eq("test_id", testId);
  if (attErr) throw attErr;

  const { error: updErr } = await supabase
    .from("tests")
    .update({
      status: "pending",
      in_progress: null,
      current_question_index: 0,
      started_at: null,
      completed_at: null,
      session_recording_url: null,
      proctoring: null,
      score_correct: null,
      score_total: null,
      score_percent: null,
      ai_analysis: null,
    })
    .eq("id", testId);
  if (updErr) throw updErr;
}
