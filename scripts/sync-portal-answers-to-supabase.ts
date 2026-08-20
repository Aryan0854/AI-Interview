/**
 * Push every completed portal click-by-click row into Supabase test_attempts.
 * Does not update tests.score_correct / score_total / score_percent.
 *
 * Usage:
 *   npx tsx scripts/sync-portal-answers-to-supabase.ts
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig, loadProjectEnv } from "./load-env";

const ROOT = process.cwd();
const OVERLAY_JSON = join(ROOT, "src", "data", "portal-question-answers.json");

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

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseOptionIndex(selected: string, options: string[]): number | null {
  const raw = selected.replace(/[—–]/g, "").trim();
  if (!raw || /^not answered$/i.test(raw)) return null;
  const letter = raw.match(/^([A-D])\)/i);
  if (letter) return letter[1].toUpperCase().charCodeAt(0) - 65;
  const stripped = raw.replace(/^[A-D]\)\s*/i, "").trim();
  const idx = options.findIndex((opt) => {
    const a = String(opt ?? "").trim().toLowerCase();
    const b = stripped.toLowerCase();
    return a === b || a.startsWith(b) || b.startsWith(a);
  });
  return idx >= 0 ? idx : null;
}

async function fetchAllAttempts(testIds: string[]) {
  const rows: Array<{ test_id: string; is_correct: boolean | null; session_key: string | null }> = [];
  const pageSize = 1000;
  for (let i = 0; i < testIds.length; i += 50) {
    const chunk = testIds.slice(i, i + 50);
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("test_attempts")
        .select("test_id, is_correct, session_key")
        .in("test_id", chunk)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
  }
  return rows;
}

function scoreKey(row: {
  id: string;
  score_correct: number | null;
  score_total: number | null;
  score_percent: number | null;
}) {
  return `${row.id}|${row.score_correct}|${row.score_total}|${row.score_percent}`;
}

async function main() {
  const overlay: Record<string, OverlayAnswer[]> = existsSync(OVERLAY_JSON)
    ? JSON.parse(readFileSync(OVERLAY_JSON, "utf8"))
    : {};

  const { data: tests, error } = await supabase
    .from("tests")
    .select("id, employee_id, employee_code, status, score_correct, score_total, score_percent")
    .eq("status", "completed");
  if (error) throw error;
  const completed = tests || [];
  const beforeKeys = completed.map(scoreKey).sort();

  const attemptRows = await fetchAllAttempts(completed.map((t) => t.id));
  const countByTest = new Map<string, number>();
  for (const row of attemptRows) {
    countByTest.set(row.test_id, (countByTest.get(row.test_id) || 0) + 1);
  }

  let upserted = 0;
  let testsFilled = 0;
  let skippedLive = 0;

  for (const test of completed) {
    const code = String(test.employee_code || "");
    const answers = (overlay[code] || []).filter((row) => hasSelected(row.selected));
    if (!answers.length) continue;

    const existingCount = countByTest.get(test.id) || 0;
    if (existingCount >= answers.length) continue;

    const { data: questions, error: qErr } = await supabase
      .from("test_questions")
      .select("id, question_index, question_text, options, correct_option_index")
      .eq("test_id", test.id)
      .order("question_index");
    if (qErr) throw qErr;
    const qList = questions || [];
    if (!qList.length) {
      console.warn(`No questions in Supabase for ${code}`);
      continue;
    }

    const { data: existing } = await supabase
      .from("test_attempts")
      .select("id, session_key")
      .eq("test_id", test.id);
    const live = (existing || []).filter(
      (row) =>
        row.session_key &&
        !String(row.session_key).startsWith("excel") &&
        row.session_key !== "score-matched-fill"
    );
    if (live.length >= answers.length) {
      skippedLive++;
      continue;
    }

    const qByIndex = new Map(qList.map((q) => [Number(q.question_index), q]));
    const used = new Set<string>();
    const payload = [];
    for (const answer of answers) {
      const needle = normalizeText(answer.question);
      const byText =
        qList.find((q) => {
          const hay = normalizeText(String(q.question_text || ""));
          return hay === needle || hay.startsWith(needle.slice(0, 80)) || needle.startsWith(hay.slice(0, 80));
        }) || null;
      const byIndex =
        qByIndex.get(answer.question_index) ||
        qByIndex.get(answer.question_index - 1) ||
        qByIndex.get(answer.question_index + 1);
      const q = byText || byIndex;
      if (!q || used.has(q.id)) continue;
      const options = Array.isArray(q.options) ? q.options : [];
      const selectedIndex = parseOptionIndex(answer.selected, options);
      if (selectedIndex == null) continue;
      used.add(q.id);
      payload.push({
        test_id: test.id,
        employee_id: test.employee_id,
        question_id: q.id,
        selected_option_index: selectedIndex,
        is_correct: answer.is_correct ?? selectedIndex === q.correct_option_index,
        time_taken_seconds: 0,
        session_key: "supabase-portal-answers",
        created_at: answer.submitted_at || new Date().toISOString(),
      });
    }
    if (!payload.length) {
      console.warn(`Could not map overlay answers for ${code}`);
      continue;
    }

    await supabase.from("test_attempts").delete().eq("test_id", test.id);
    const { error: insErr } = await supabase.from("test_attempts").insert(payload);
    if (insErr) {
      console.error(code, insErr.message);
      continue;
    }
    testsFilled++;
    upserted += payload.length;
    console.log(`Synced ${code}: ${payload.length} attempts (score ${test.score_correct}/${test.score_total} unchanged)`);
  }

  const { data: afterTests, error: afterErr } = await supabase
    .from("tests")
    .select("id, score_correct, score_total, score_percent")
    .eq("status", "completed");
  if (afterErr) throw afterErr;
  const afterKeys = (afterTests || []).map(scoreKey).sort();
  if (beforeKeys.join() !== afterKeys.join()) {
    console.error("SCORE DRIFT DETECTED");
    process.exit(1);
  }

  const afterAttempts = await fetchAllAttempts(completed.map((t) => t.id));
  const afterByTest = new Map<string, number>();
  for (const row of afterAttempts) afterByTest.set(row.test_id, (afterByTest.get(row.test_id) || 0) + 1);
  const stillMissing = completed.filter((t) => (afterByTest.get(t.id) || 0) === 0).map((t) => t.employee_code);

  console.log(
    JSON.stringify(
      {
        completed: completed.length,
        testsFilled,
        attemptsWritten: upserted,
        skippedLive,
        totalAttemptsNow: afterAttempts.length,
        testsWithAttempts: completed.filter((t) => (afterByTest.get(t.id) || 0) > 0).length,
        stillMissingAttempts: stillMissing,
        scoresUnchanged: true,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
