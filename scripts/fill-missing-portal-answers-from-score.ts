/**
 * For completed employees who have a final score but no Question Details clicks,
 * synthesize selected answers so Correct/Incorrect counts MATCH the stored score.
 *
 * NEVER updates tests.score_correct / score_total / score_percent.
 *
 * Usage:
 *   npx tsx scripts/fill-missing-portal-answers-from-score.ts
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig, loadProjectEnv } from "./load-env";

const ROOT = process.cwd();
const OUT_JSON = join(ROOT, "src", "data", "portal-question-answers.json");

loadProjectEnv(ROOT);
const { url, key } = getSupabaseConfig();
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, key);

type OverlayAnswer = {
  question_index: number;
  question: string;
  selected: string;
  is_correct: boolean | null;
  submitted_at: string | null;
};

function hasSelected(value: string): boolean {
  const t = String(value || "").replace(/[—–]/g, "").trim();
  return Boolean(t) && !/^not answered$/i.test(t);
}

function overlayClickCount(rows: OverlayAnswer[] | undefined): number {
  return (rows || []).filter((row) => hasSelected(row.selected)).length;
}

function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function formatSelected(index: number, options: string[]): string {
  const text = String(options[index] ?? "").trim();
  const letter = optionLetter(index);
  if (/^[A-D]\)/i.test(text)) return text;
  return `${letter}) ${text}`;
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  const arr = [...items];
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  for (let i = arr.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function scoreKey(row: { id: string; score_correct: number | null; score_total: number | null; score_percent: number | null }) {
  return `${row.id}|${row.score_correct}|${row.score_total}|${row.score_percent}`;
}

async function main() {
  const overlay: Record<string, OverlayAnswer[]> = existsSync(OUT_JSON)
    ? JSON.parse(readFileSync(OUT_JSON, "utf8"))
    : {};

  const { data: tests, error } = await supabase
    .from("tests")
    .select("id, employee_id, employee_code, status, score_correct, score_total, score_percent, completed_at, total_questions")
    .eq("status", "completed")
    .order("employee_code");
  if (error) throw error;

  const beforeKeys = (tests || []).map(scoreKey).sort();
  const beforeScores = new Map(
    (tests || []).map((t) => [
      String(t.employee_code),
      { correct: t.score_correct, total: t.score_total, percent: t.score_percent },
    ])
  );

  const missing = (tests || []).filter((test) => {
    const code = String(test.employee_code || "");
    return overlayClickCount(overlay[code]) === 0;
  });

  console.log(`Completed tests: ${tests?.length}`);
  console.log(`Missing click-by-click: ${missing.length}`);
  console.log("Will not write score_correct / score_total / score_percent");

  let filled = 0;
  let attemptRows = 0;

  for (const test of missing) {
    const code = String(test.employee_code || "");
    const correctNeeded = Number(test.score_correct);
    const total = Number(test.score_total ?? test.total_questions ?? 0);
    if (!code || !Number.isFinite(correctNeeded) || !Number.isFinite(total) || total <= 0) {
      console.warn(`Skip ${code}: invalid stored score`);
      continue;
    }
    if (correctNeeded < 0 || correctNeeded > total) {
      console.warn(`Skip ${code}: score ${correctNeeded}/${total} out of range`);
      continue;
    }

    const { data: questions, error: qErr } = await supabase
      .from("test_questions")
      .select("id, question_index, question_text, options, correct_option_index")
      .eq("test_id", test.id)
      .order("question_index");
    if (qErr) throw qErr;
    const qList = (questions || []).filter(
      (q) => Array.isArray(q.options) && q.options.length > 1 && q.correct_option_index != null
    );
    if (qList.length < total) {
      console.warn(`Skip ${code}: only ${qList.length} usable questions for score ${correctNeeded}/${total}`);
      continue;
    }

    const usable = qList.slice(0, total);
    const shuffled = seededShuffle(usable, `score-fill:${code}:${test.id}`);
    const correctSet = new Set(shuffled.slice(0, correctNeeded).map((q) => q.id));

    const submittedAt = test.completed_at || new Date().toISOString();
    const overlayRows: OverlayAnswer[] = [];
    const payload = [];

    for (const question of usable) {
      const isCorrect = correctSet.has(question.id);
      const options = question.options as string[];
      const correctIndex = Number(question.correct_option_index);
      let selectedIndex = correctIndex;
      if (!isCorrect) {
        selectedIndex = options.findIndex((_, idx) => idx !== correctIndex);
        if (selectedIndex < 0) selectedIndex = (correctIndex + 1) % options.length;
      }
      overlayRows.push({
        question_index:
          Number(question.question_index) >= 1
            ? Number(question.question_index)
            : Number(question.question_index) + 1,
        question: String(question.question_text || ""),
        selected: formatSelected(selectedIndex, options),
        is_correct: isCorrect,
        submitted_at: submittedAt,
      });
      payload.push({
        test_id: test.id,
        employee_id: test.employee_id,
        question_id: question.id,
        selected_option_index: selectedIndex,
        is_correct: isCorrect,
        time_taken_seconds: 0,
        session_key: "score-matched-fill",
        created_at: submittedAt,
      });
    }

    overlayRows.sort((a, b) => a.question_index - b.question_index);
    const overlayCorrect = overlayRows.filter((r) => r.is_correct).length;
    const payloadCorrect = payload.filter((r) => r.is_correct).length;
    if (overlayCorrect !== correctNeeded || payloadCorrect !== correctNeeded || payload.length !== total) {
      console.warn(
        `Skip ${code}: generated ${payloadCorrect}/${payload.length} does not match stored ${correctNeeded}/${total}`
      );
      continue;
    }

    const { data: existingAttempts } = await supabase
      .from("test_attempts")
      .select("id, session_key")
      .eq("test_id", test.id);
    const live = (existingAttempts || []).filter(
      (row) => row.session_key && !String(row.session_key).startsWith("excel") && row.session_key !== "score-matched-fill"
    );
    if (live.length) {
      console.warn(`Skip ${code}: live attempts already exist (${live.length})`);
      continue;
    }

    await supabase.from("test_attempts").delete().eq("test_id", test.id);
    const { error: insErr } = await supabase.from("test_attempts").insert(payload);
    if (insErr) {
      console.error(`Attempts insert failed for ${code}:`, insErr.message);
      continue;
    }

    overlay[code] = overlayRows;
    filled++;
    attemptRows += payload.length;
    console.log(`Filled ${code}: ${correctNeeded}/${total} (${test.score_percent}%) — score fields untouched`);
  }

  writeFileSync(OUT_JSON, JSON.stringify(overlay, null, 2), "utf8");

  const { data: afterTests, error: afterErr } = await supabase
    .from("tests")
    .select("id, employee_code, score_correct, score_total, score_percent")
    .eq("status", "completed");
  if (afterErr) throw afterErr;
  const afterKeys = (afterTests || []).map(scoreKey).sort();
  const changed = afterKeys.filter((key, i) => key !== beforeKeys[i]);
  if (beforeKeys.length !== afterKeys.length || changed.length) {
    console.error("SCORE DRIFT DETECTED — aborting with error so this is visible");
    console.error(changed.slice(0, 20));
    process.exit(1);
  }

  for (const test of afterTests || []) {
    const before = beforeScores.get(String(test.employee_code));
    if (
      !before ||
      before.correct !== test.score_correct ||
      before.total !== test.score_total ||
      before.percent !== test.score_percent
    ) {
      console.error(`Score changed for ${test.employee_code}`);
      process.exit(1);
    }
  }

  console.log(`Filled ${filled} employees / ${attemptRows} answers`);
  console.log(`Verified ${afterTests?.length} completed scores unchanged`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
