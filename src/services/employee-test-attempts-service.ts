import { supabase } from "@/lib/db";
import { allowLocalTestsFallback, useSupabasePrimary } from "@/lib/db-mode";
import { formatAttemptResult, formatPortalTimestamp } from "@/lib/portal-format";
import { localTestsDb, type LocalTestAttempt, type LocalTestQuestion } from "@/services/local-tests-db";

export interface AdminTestQuestionAttempt {
  question_index: number;
  question_text: string;
  options: string[];
  selected_option_index: number | null;
  selected_option_text: string | null;
  is_correct: boolean | null;
  submitted_at: string | null;
}

function optionLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

function mapQuestionAttempt(
  question: Pick<
    LocalTestQuestion,
    "id" | "question_index" | "question_text" | "options"
  >,
  attempt?: Pick<LocalTestAttempt, "selected_option_index" | "is_correct" | "created_at">
): AdminTestQuestionAttempt {
  const selectedIndex = attempt?.selected_option_index ?? null;
  const selectedText =
    selectedIndex !== null && question.options[selectedIndex] != null
      ? `${optionLabel(selectedIndex)}) ${question.options[selectedIndex]}`
      : null;

  return {
    question_index: question.question_index,
    question_text: question.question_text,
    options: question.options,
    selected_option_index: selectedIndex,
    selected_option_text: selectedText,
    is_correct: attempt?.is_correct ?? null,
    submitted_at: attempt?.created_at ?? null,
  };
}

function buildAttemptsForTest(
  questions: LocalTestQuestion[],
  attempts: LocalTestAttempt[]
): AdminTestQuestionAttempt[] {
  const attemptsByQuestion = new Map<string, LocalTestAttempt>();
  for (const attempt of attempts) {
    attemptsByQuestion.set(attempt.question_id, attempt);
  }

  return [...questions]
    .sort((a, b) => a.question_index - b.question_index)
    .map((question) => mapQuestionAttempt(question, attemptsByQuestion.get(question.id)));
}

export { formatAttemptResult, formatPortalTimestamp as formatSubmittedAt };

export function formatQuestionAnswerBlock(questions: AdminTestQuestionAttempt[]): string {
  if (questions.length === 0) return "";

  const lines: string[] = [`Assigned Questions (${questions.length})`];
  for (const q of questions) {
    lines.push(q.question_text);
    if (q.selected_option_text) {
      const suffix = formatAttemptResult(q.is_correct);
      lines.push(`Selected: ${q.selected_option_text}${suffix ? ` (${suffix})` : ""}`);
    } else {
      lines.push("Not answered");
    }
    if (q.submitted_at) {
      lines.push(`Submitted: ${formatPortalTimestamp(q.submitted_at)}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export async function getTestQuestionAttempts(
  testId: string
): Promise<AdminTestQuestionAttempt[] | null> {
  const batch = await getTestQuestionAttemptsBatch([testId]);
  const questions = batch.get(testId);
  if (!questions) {
    const test = await localTestsDb.getTestById(testId);
    if (!test) return null;
    return [];
  }
  return questions;
}

export async function getTestQuestionAttemptsBatch(
  testIds: string[]
): Promise<Map<string, AdminTestQuestionAttempt[]>> {
  const result = new Map<string, AdminTestQuestionAttempt[]>();
  const uniqueIds = [...new Set(testIds.filter(Boolean))];
  if (uniqueIds.length === 0) return result;

  if (useSupabasePrimary()) {
    try {
      const [{ data: questionRows, error: qErr }, { data: attemptRows, error: aErr }] =
        await Promise.all([
          supabase.from("test_questions").select("*").in("test_id", uniqueIds),
          supabase.from("test_attempts").select("*").in("test_id", uniqueIds),
        ]);

      if (qErr) throw qErr;
      if (aErr) throw aErr;

      const questionsByTest = new Map<string, LocalTestQuestion[]>();
      for (const row of questionRows ?? []) {
        const list = questionsByTest.get(row.test_id) ?? [];
        list.push({
          id: row.id,
          test_id: row.test_id,
          question_index: row.question_index,
          question_text: row.question_text,
          options: row.options || [],
          correct_option_index: row.correct_option_index,
          explanation: row.explanation || "",
          difficulty: row.difficulty,
          topic_id: row.topic_id,
          topic_title: row.topic_title || "",
          created_at: row.created_at,
        });
        questionsByTest.set(row.test_id, list);
      }

      const attemptsByTest = new Map<string, LocalTestAttempt[]>();
      for (const row of attemptRows ?? []) {
        const list = attemptsByTest.get(row.test_id) ?? [];
        list.push({
          id: row.id,
          test_id: row.test_id,
          employee_id: row.employee_id,
          question_id: row.question_id,
          selected_option_index: row.selected_option_index,
          is_correct: row.is_correct,
          time_taken_seconds: row.time_taken_seconds ?? 0,
          session_key: row.session_key || "",
          created_at: row.created_at,
        });
        attemptsByTest.set(row.test_id, list);
      }

      for (const testId of uniqueIds) {
        const questions = questionsByTest.get(testId) ?? [];
        const attempts = attemptsByTest.get(testId) ?? [];
        result.set(testId, buildAttemptsForTest(questions, attempts));
      }
      return result;
    } catch (err) {
      if (!allowLocalTestsFallback()) throw err;
      console.warn("Batch attempts Supabase failed, using local fallback:", err);
    }
  }

  const db = await localTestsDb.loadDB();
  for (const testId of uniqueIds) {
    const questions = db.test_questions.filter((q) => q.test_id === testId);
    const attempts = db.test_attempts.filter((a) => a.test_id === testId);
    result.set(testId, buildAttemptsForTest(questions, attempts));
  }
  return result;
}
