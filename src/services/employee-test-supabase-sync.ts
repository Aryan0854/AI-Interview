import { supabase } from "@/lib/db";
import type { EmployeeAccount } from "@/lib/employee-auth";
import {
  localTestsDb,
  type LocalTest,
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

  const department = "general";

  const { data: inserted, error } = await supabase
    .from("employees")
    .upsert(
      {
        employee_id: code,
        email: profile?.email || `${code}@nokia.com`,
        full_name: profile?.full_name || code,
        department,
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

function buildTestPayload(test: LocalTest, employeeUuid: string) {
  const aiAnalysis =
    test.ai_analysis ??
    (typeof test.in_progress === "string" ? test.in_progress : null);

  return {
    id: test.id,
    employee_id: employeeUuid,
    employee_code: test.employee_id,
    topic_id: test.topic_id,
    subject_id: test.subject_id,
    topic_title: test.topic_title ?? null,
    subject_title: test.subject_title ?? null,
    difficulty: test.difficulty,
    total_questions: test.total_questions,
    time_limit_seconds: test.time_limit_seconds,
    status: test.status,
    current_question_index: test.current_question_index,
    started_at: test.started_at,
    completed_at: test.completed_at,
    in_progress: typeof test.in_progress === "object" ? test.in_progress : null,
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
    await supabase.from("test_attempts").delete().eq("test_id", testId);
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
  const { error } = await supabase
    .from("tests")
    .upsert(buildTestPayload(test, employeeUuid), { onConflict: "id" });
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
  if (!bundle) return;
  await syncTestToSupabase(bundle.test, bundle.employeeUuid);
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
