import { readFileSync, existsSync } from "fs";
import { join } from "path";

export type PortalExcelAnswer = {
  question_index: number;
  question: string;
  selected: string;
  is_correct: boolean | null;
  submitted_at: string | null;
};

type AnswerMap = Record<string, PortalExcelAnswer[]>;

let cache: AnswerMap | null = null;

function loadRaw(): AnswerMap {
  if (cache) return cache;
  const path = join(process.cwd(), "src", "data", "portal-question-answers.json");
  if (!existsSync(path)) {
    cache = {};
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(path, "utf8")) as AnswerMap;
  } catch {
    cache = {};
  }
  return cache;
}

export function getPortalExcelAnswers(employeeId: string): PortalExcelAnswer[] {
  const map = loadRaw();
  const key = String(employeeId || "").trim();
  return map[key] || map[key.toUpperCase()] || [];
}

export function portalExcelAnswersToAttempts(employeeId: string) {
  return getPortalExcelAnswers(employeeId)
    .filter((row) => row.selected && !/^not answered$/i.test(row.selected) && row.selected !== "—")
    .map((row) => ({
      question_index: row.question_index,
      question_text: row.question,
      options: [] as string[],
      selected_option_index: null as number | null,
      selected_option_text: row.selected,
      is_correct: row.is_correct,
      submitted_at: row.submitted_at,
    }));
}
