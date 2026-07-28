import { localTestsDb } from "@/services/local-tests-db";

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

export function formatAttemptResult(isCorrect: boolean | null): string {
  if (isCorrect === true) return "Correct";
  if (isCorrect === false) return "Incorrect";
  return "";
}

export function formatSubmittedAt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

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
      lines.push(`Submitted: ${formatSubmittedAt(q.submitted_at)}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export async function getTestQuestionAttempts(
  testId: string
): Promise<AdminTestQuestionAttempt[] | null> {
  const test = await localTestsDb.getTestById(testId);
  if (!test) return null;

  const [questions, rawAttempts] = await Promise.all([
    localTestsDb.getQuestions(testId),
    localTestsDb.getAttempts(testId),
  ]);

  const attemptsByQuestion = new Map<string, (typeof rawAttempts)[0]>();
  for (const attempt of rawAttempts) {
    attemptsByQuestion.set(attempt.question_id, attempt);
  }

  const sortedQuestions = [...questions].sort((a, b) => a.question_index - b.question_index);
  return sortedQuestions.map((question) => {
    const attempt = attemptsByQuestion.get(question.id);
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
  });
}
