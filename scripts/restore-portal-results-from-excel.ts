/**
 * Restore Employee Portal completed tests from an admin Excel export.
 *
 * Usage:
 *   npx tsx scripts/restore-portal-results-from-excel.ts --file "C:/Users/Aryan/Downloads/employee_portal_test_results_2026-08-19.xlsx"
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig, loadProjectEnv } from "./load-env";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const fileArg = args.find((a) => a.startsWith("--file="));
const sourceFile =
  fileArg?.split("=").slice(1).join("=") ||
  join(process.env.USERPROFILE || "", "Downloads", "employee_portal_test_results_2026-08-19.xlsx");

loadProjectEnv(ROOT);
const { url, key } = getSupabaseConfig();
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, key);

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "text" in (value as any)) return String((value as any).text ?? "").trim();
  if (typeof value === "object" && "result" in (value as any)) return String((value as any).result ?? "").trim();
  if (typeof value === "object" && "richText" in (value as any)) {
    return ((value as any).richText as Array<{ text?: string }>).map((p) => p.text ?? "").join("").trim();
  }
  return String(value).trim();
}

function parseScore(raw: string): { correct: number; total: number; percent: number } | null {
  const m = raw.match(/(\d+)\s*\/\s*(\d+)(?:\s*\((\d+)%\))?/);
  if (!m) return null;
  const correct = Number(m[1]);
  const total = Number(m[2]);
  const percent = m[3] != null ? Number(m[3]) : total > 0 ? Math.round((correct / total) * 100) : 0;
  return { correct, total, percent };
}

function parseCompletedOn(raw: string): Date | null {
  const text = raw.replace(/[—–-]/g, "").trim();
  if (!text) return null;
  // Admin export used dateStyle:medium on Vercel (UTC).
  const utc = Date.parse(`${text} UTC`);
  if (!Number.isNaN(utc)) return new Date(utc);
  const local = Date.parse(text);
  if (!Number.isNaN(local)) return new Date(local);
  return null;
}

function parseSubmittedAt(raw: string): Date | null {
  const text = raw.replace(/[—–]/g, "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)$/i
  );
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    let hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6] || "0");
    const ap = m[7].toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}+05:30`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return parseCompletedOn(text);
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

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

type ParsedAnswer = {
  question: string;
  selected: string;
  result: string;
  submittedAt: string;
};

function parseQaBlock(raw: string): ParsedAnswer[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const chunks = text
    .replace(/^Assigned Questions \(\d+\)\s*/i, "")
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter(Boolean);

  const answers: ParsedAnswer[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const selectedLine = lines.find((l) => /^Selected:/i.test(l)) || "";
    const submittedLine = lines.find((l) => /^Submitted:/i.test(l)) || "";
    const question = lines.filter((l) => !/^Selected:/i.test(l) && !/^Submitted:/i.test(l)).join(" ");
    const selectedMatch = selectedLine.match(/^Selected:\s*(.*?)\s*(?:\((Correct|Incorrect)\))?\s*$/i);
    answers.push({
      question,
      selected: selectedMatch?.[1] || (lines.some((l) => /^Not answered$/i.test(l)) ? "" : ""),
      result: selectedMatch?.[2] || "",
      submittedAt: submittedLine.replace(/^Submitted:\s*/i, "").trim(),
    });
  }
  return answers;
}

function parseViolations(raw: string): Array<{ type: string; timestamp: string }> {
  const text = raw.replace(/[—–]/g, "").trim();
  if (!text) return [];
  const items: Array<{ type: string; timestamp: string }> = [];
  for (const line of text.split(/\n+/)) {
    const m = line.match(/^\s*\d+\.\s*(.+?)(?:\s*\((.+)\))?\s*$/);
    if (!m) continue;
    const when = m[2] ? parseCompletedOn(m[2]) : null;
    items.push({
      type: m[1].trim(),
      timestamp: (when || new Date()).toISOString(),
    });
  }
  return items;
}

function classifyViolation(type: string): { category: string; severity: string } {
  const t = type.toLowerCase();
  if (t.includes("tab") || t.includes("focus") || t.includes("fullscreen")) {
    return { category: "browser", severity: "medium" };
  }
  if (t.includes("face")) return { category: "face", severity: "high" };
  return { category: "other", severity: "low" };
}

function matchQuestion(
  questionText: string,
  questions: Array<{ id: string; question_index: number; question_text: string; options: any; correct_option_index: number }>
) {
  const needle = normalizeText(questionText);
  if (!needle) return null;
  let best: (typeof questions)[number] | null = null;
  let bestLen = 0;
  for (const q of questions) {
    const hay = normalizeText(String(q.question_text || ""));
    if (!hay) continue;
    if (hay === needle || hay.startsWith(needle) || needle.startsWith(hay)) {
      const len = Math.min(hay.length, needle.length);
      if (len > bestLen) {
        best = q;
        bestLen = len;
      }
    }
  }
  return best;
}

type QuestionRow = {
  employeeId: string;
  questionNum: number;
  question: string;
  selected: string;
  result: string;
  submittedAt: string;
};

async function main() {
  console.log(`Reading ${sourceFile}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(sourceFile);
  const resultsSheet = wb.worksheets.find((s) => /portal results/i.test(s.name)) || wb.worksheets[0];
  const detailsSheet = wb.worksheets.find((s) => /question details/i.test(s.name));
  if (!resultsSheet) throw new Error("Employee Portal Results sheet missing");

  const completed: Array<{
    employeeId: string;
    name: string;
    score: { correct: number; total: number; percent: number };
    completedOn: Date | null;
    flags: number;
    violations: Array<{ type: string; timestamp: string }>;
    qa: ParsedAnswer[];
  }> = [];

  resultsSheet.eachRow((row, n) => {
    if (n === 1) return;
    const employeeId = cellText(row.getCell(2).value);
    const status = cellText(row.getCell(8).value);
    if (!employeeId || !/^completed$/i.test(status)) return;
    const score = parseScore(cellText(row.getCell(10).value));
    if (!score) return;
    const flagsRaw = cellText(row.getCell(11).value);
    const flags = /^\d+$/.test(flagsRaw) ? Number(flagsRaw) : 0;
    const violations = parseViolations(cellText(row.getCell(12).value));
    completed.push({
      employeeId,
      name: cellText(row.getCell(1).value),
      score,
      completedOn: parseCompletedOn(cellText(row.getCell(9).value)),
      flags: Math.max(flags, violations.length),
      violations,
      qa: parseQaBlock(cellText(row.getCell(14).value)),
    });
  });

  const detailsByEmp = new Map<string, QuestionRow[]>();
  if (detailsSheet) {
    detailsSheet.eachRow((row, n) => {
      if (n === 1) return;
      const employeeId = cellText(row.getCell(1).value);
      if (!employeeId) return;
      const item: QuestionRow = {
        employeeId,
        questionNum: Number(cellText(row.getCell(3).value)) || 0,
        question: cellText(row.getCell(4).value),
        selected: cellText(row.getCell(5).value),
        result: cellText(row.getCell(6).value),
        submittedAt: cellText(row.getCell(7).value),
      };
      const list = detailsByEmp.get(employeeId) || [];
      list.push(item);
      detailsByEmp.set(employeeId, list);
    });
  }

  console.log(`Completed rows in Excel: ${completed.length}`);

  const { data: tests, error: testsErr } = await supabase
    .from("tests")
    .select("id, employee_id, employee_code, status, total_questions");
  if (testsErr) throw testsErr;
  const testByCode = new Map((tests || []).map((t) => [String(t.employee_code), t]));

  let updated = 0;
  let skipped = 0;
  let attemptsWritten = 0;
  const localUpdates: Array<{
    testId: string;
    employeeId: string;
    score: { correct: number; total: number; percent: number };
    completedAt: string;
    startedAt: string;
    proctoring: { warningCount: number; violations: any[]; autoSubmitted: boolean } | null;
  }> = [];

  for (const row of completed) {
    const test = testByCode.get(row.employeeId);
    if (!test?.id) {
      console.warn(`No test for ${row.employeeId} ${row.name}`);
      skipped++;
      continue;
    }

    const { data: questions, error: qErr } = await supabase
      .from("test_questions")
      .select("id, question_index, question_text, options, correct_option_index")
      .eq("test_id", test.id)
      .order("question_index");
    if (qErr) throw qErr;
    const qList = questions || [];
    const qByIndex = new Map(qList.map((q) => [Number(q.question_index), q]));
    const details = (detailsByEmp.get(row.employeeId) || []).sort((a, b) => a.questionNum - b.questionNum);
    const mergedAnswers: ParsedAnswer[] = [...row.qa];
    for (const detail of details) {
      if (!detail.selected || /^not answered$/i.test(detail.selected) || detail.selected === "—") continue;
      const already = mergedAnswers.some(
        (a) => a.selected && normalizeText(a.question).startsWith(normalizeText(detail.question).slice(0, 40))
      );
      if (!already) {
        mergedAnswers.push({
          question: detail.question,
          selected: detail.selected,
          result: detail.result,
          submittedAt: detail.submittedAt,
        });
      }
    }

    const attempts: Array<{
      test_id: string;
      employee_id: string;
      question_id: string;
      selected_option_index: number;
      is_correct: boolean;
      time_taken_seconds: number;
      session_key: string;
      created_at: string;
    }> = [];
    const usedQuestionIds = new Set<string>();
    let submittedAt: Date | null = null;

    for (const [i, detail] of mergedAnswers.entries()) {
      const q =
        matchQuestion(detail.question, qList) ||
        qByIndex.get(i) ||
        qByIndex.get(detail.question ? -1 : i);
      if (!q || usedQuestionIds.has(q.id)) continue;
      const selectedIndex = parseOptionIndex(detail.selected, Array.isArray(q.options) ? q.options : []);
      if (selectedIndex == null) continue;
      const result = detail.result.toLowerCase();
      const isCorrect =
        result === "correct" ? true : result === "incorrect" ? false : selectedIndex === q.correct_option_index;
      const created = parseSubmittedAt(detail.submittedAt);
      if (created && (!submittedAt || created < submittedAt)) submittedAt = created;
      usedQuestionIds.add(q.id);
      attempts.push({
        test_id: test.id,
        employee_id: test.employee_id,
        question_id: q.id,
        selected_option_index: selectedIndex,
        is_correct: isCorrect,
        time_taken_seconds: 0,
        session_key: "excel-restore-2026-08-19",
        created_at: (created || row.completedOn || new Date()).toISOString(),
      });
    }

    const completedAt = row.completedOn || submittedAt || new Date();
    const startedAt = submittedAt || new Date(completedAt.getTime() - 30 * 60 * 1000);
    const violations = row.violations.map((v) => ({
      ...v,
      ...classifyViolation(v.type),
    }));
    const proctoring =
      row.flags > 0 || violations.length > 0
        ? {
            warningCount: Math.max(row.flags, violations.length),
            violations,
            autoSubmitted: false,
          }
        : null;

    await supabase.from("test_attempts").delete().eq("test_id", test.id);
    let attemptError = false;
    for (let i = 0; i < attempts.length; i += 50) {
      const chunk = attempts.slice(i, i + 50);
      const { error } = await supabase.from("test_attempts").insert(chunk);
      if (error) {
        console.error(`Attempts failed for ${row.employeeId}:`, error.message);
        attemptError = true;
        break;
      }
    }
    if (attemptError) {
      skipped++;
      continue;
    }

    const { error: updErr } = await supabase
      .from("tests")
      .update({
        status: "completed",
        score_correct: row.score.correct,
        score_total: row.score.total,
        score_percent: row.score.percent,
        completed_at: completedAt.toISOString(),
        started_at: startedAt.toISOString(),
        current_question_index: row.score.total,
        in_progress: null,
        proctoring,
      })
      .eq("id", test.id);
    if (updErr) {
      console.error(`Test update failed for ${row.employeeId}:`, updErr.message);
      skipped++;
      continue;
    }

    attemptsWritten += attempts.length;
    updated++;
    localUpdates.push({
      testId: test.id,
      employeeId: row.employeeId,
      score: row.score,
      completedAt: completedAt.toISOString(),
      startedAt: startedAt.toISOString(),
      proctoring,
    });
    if (updated % 10 === 0) console.log(`  restored ${updated}/${completed.length}`);
  }

  console.log(`Updated ${updated} tests, skipped ${skipped}, wrote ${attemptsWritten} attempts`);

  const localPaths = [
    join(ROOT, "uploads", "local_tests_db.json"),
    join(ROOT, "src", "data", "local_tests_db.json"),
  ].filter((p) => existsSync(p));

  for (const path of localPaths) {
    const db = JSON.parse(readFileSync(path, "utf8"));
    const byId = new Map(localUpdates.map((u) => [u.testId, u]));
    const byCode = new Map(localUpdates.map((u) => [u.employeeId, u]));
    let touched = 0;
    for (const test of db.tests || []) {
      const upd = byId.get(test.id) || byCode.get(String(test.employee_id));
      if (!upd) continue;
      test.status = "completed";
      test.score_correct = upd.score.correct;
      test.score_total = upd.score.total;
      test.score_percent = upd.score.percent;
      test.completed_at = upd.completedAt;
      test.started_at = upd.startedAt;
      test.current_question_index = upd.score.total;
      test.in_progress = null;
      test.proctoring = upd.proctoring;
      touched++;
    }
    writeFileSync(path, JSON.stringify(db, null, 2), "utf8");
    console.log(`Patched ${touched} tests in ${path}`);
  }

  const { count: completedCount } = await supabase
    .from("tests")
    .select("*", { count: "exact", head: true })
    .eq("status", "completed");
  console.log(`Supabase completed tests now: ${completedCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
