/**
 * Click-by-click answers come ONLY from the "Question Details" sheet.
 * Scores/status come from the latest "Employee Portal Results" file (see restore script).
 *
 * Usage:
 *   npx tsx scripts/import-portal-excel-answers.ts --dir "C:/Users/Aryan/Downloads/abc"
 */
import { readdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig, loadProjectEnv } from "./load-env";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const dirArg = args.find((a) => a.startsWith("--dir="));
const SOURCE_DIR =
  dirArg?.split("=").slice(1).join("=") ||
  join(process.env.USERPROFILE || "", "Downloads", "abc");
const EXTRA_FILES = [
  join(ROOT, "employee_portal_test_results_2026-08-19.xlsx"),
];
const OUT_JSON = join(ROOT, "src", "data", "portal-question-answers.json");

loadProjectEnv(ROOT);
const { url, key } = getSupabaseConfig();
const supabase = url && key ? createClient(url, key) : null;

type Answer = {
  question_index: number;
  question: string;
  selected: string;
  is_correct: boolean | null;
  submitted_at: string | null;
};

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "text" in (value as any)) return String((value as any).text ?? "").trim();
  if (typeof value === "object" && "result" in (value as any)) return String((value as any).result ?? "").trim();
  if (typeof value === "object" && "richText" in (value as any)) {
    return ((value as any).richText as Array<{ text?: string }>).map((p) => p.text ?? "").join("").trim();
  }
  return String(value ?? "").trim();
}

function hasSelected(value: string): boolean {
  const t = value.replace(/[—–]/g, "").trim();
  return Boolean(t) && !/^not answered$/i.test(t);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseSubmittedAt(raw: string): string | null {
  const text = raw.replace(/[—–]/g, "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] || "0");
  const ap = m[7].toLowerCase();
  if (ap === "pm" && hour < 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}+05:30`;
}

function resultToCorrect(result: string): boolean | null {
  const t = result.toLowerCase();
  if (t === "correct") return true;
  if (t === "incorrect") return false;
  return null;
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

function listSourceFiles(): string[] {
  const files = new Map<string, string>();
  if (existsSync(SOURCE_DIR)) {
    for (const name of readdirSync(SOURCE_DIR)) {
      if (!name.toLowerCase().endsWith(".xlsx")) continue;
      if (!/employee_portal_test_results/i.test(name)) continue;
      if (name.startsWith("~$")) continue;
      files.set(name.toLowerCase(), join(SOURCE_DIR, name));
    }
  }
  for (const extra of EXTRA_FILES) {
    if (!existsSync(extra)) continue;
    const name = extra.replace(/\\/g, "/").split("/").pop() || extra;
    if (!files.has(name.toLowerCase())) files.set(name.toLowerCase(), extra);
  }
  return [...files.values()].sort();
}

async function main() {
  const snapshots = new Map<string, { selected: number; source: string; rows: Answer[] }>();
  const files = listSourceFiles();
  if (!files.length) {
    console.error(`No portal Excel files in ${SOURCE_DIR}`);
    process.exit(1);
  }

  for (const filePath of files) {
    const source = filePath.replace(/\\/g, "/").split("/").pop() || filePath;
    let wb: ExcelJS.Workbook;
    try {
      wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
    } catch (err) {
      console.warn(`Skipping unreadable file ${source}:`, err instanceof Error ? err.message : err);
      continue;
    }

    const detailsSheet = wb.worksheets.find((s) => /question details/i.test(s.name));
    if (!detailsSheet) {
      console.warn(`${source}: no Question Details sheet`);
      continue;
    }

    const byEmp = new Map<string, Answer[]>();
    detailsSheet.eachRow((row, n) => {
      if (n === 1) return;
      const employeeId = cellText(row.getCell(1).value);
      if (!employeeId) return;
      const list = byEmp.get(employeeId) || [];
      list.push({
        question_index: Number(cellText(row.getCell(3).value)) || list.length + 1,
        question: cellText(row.getCell(4).value),
        selected: cellText(row.getCell(5).value),
        is_correct: resultToCorrect(cellText(row.getCell(6).value)),
        submitted_at: parseSubmittedAt(cellText(row.getCell(7).value)),
      });
      byEmp.set(employeeId, list);
    });

    let withClicks = 0;
    let selectedRows = 0;
    for (const [employeeId, rows] of byEmp) {
      const selected = rows.filter((row) => hasSelected(row.selected)).length;
      if (selected === 0) continue;
      withClicks++;
      selectedRows += selected;
      const current = snapshots.get(employeeId);
      if (!current || selected > current.selected || (selected === current.selected && rows.length > current.rows.length)) {
        snapshots.set(employeeId, { selected, source, rows });
      }
    }
    console.log(`${source}: Question Details ${withClicks} employees / ${selectedRows} selected answers`);
  }

  const overlay: Record<string, Answer[]> = {};
  for (const [id, snap] of [...snapshots.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    overlay[id] = snap.rows
      .slice()
      .sort((a, b) => a.question_index - b.question_index)
      .map((row, i) => ({
        ...row,
        question_index: row.question_index > 0 ? row.question_index : i + 1,
      }));
  }

  writeFileSync(OUT_JSON, JSON.stringify(overlay, null, 2), "utf8");
  const selectedCounts = Object.values(overlay).map((rows) => rows.filter((r) => hasSelected(r.selected)).length);
  console.log(
    `Wrote Question Details overlay: ${Object.keys(overlay).length} employees / ${selectedCounts.reduce((s, n) => s + n, 0)} selected answers (${selectedCounts.filter((n) => n >= 20).length} with 20+ clicks)`
  );
  const suresh = overlay["1034988"];
  if (suresh) {
    console.log(`Suresh R 1034988: ${suresh.filter((r) => hasSelected(r.selected)).length}/${suresh.length} from ${snapshots.get("1034988")?.source}`);
  }

  if (!supabase) {
    console.warn("Supabase credentials missing; overlay JSON updated only");
    return;
  }

  const { data: tests, error } = await supabase
    .from("tests")
    .select("id, employee_id, employee_code, status")
    .eq("status", "completed");
  if (error) throw error;

  let attemptRows = 0;
  let testsFilled = 0;
  for (const test of tests || []) {
    const answers = (overlay[String(test.employee_code || "")] || []).filter((row) => hasSelected(row.selected));
    if (!answers.length) continue;

    const { data: questions } = await supabase
      .from("test_questions")
      .select("id, question_index, question_text, options, correct_option_index")
      .eq("test_id", test.id);
    const qList = questions || [];
    if (!qList.length) continue;

    const { data: existingAttempts } = await supabase
      .from("test_attempts")
      .select("id, session_key")
      .eq("test_id", test.id);
    const live = (existingAttempts || []).filter(
      (row) => row.session_key && !String(row.session_key).startsWith("excel")
    );
    if (live.length >= answers.length) continue;

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
      const selectedIndex = parseOptionIndex(answer.selected, Array.isArray(q.options) ? q.options : []);
      if (selectedIndex == null) continue;
      used.add(q.id);
      payload.push({
        test_id: test.id,
        employee_id: test.employee_id,
        question_id: q.id,
        selected_option_index: selectedIndex,
        is_correct: answer.is_correct ?? selectedIndex === q.correct_option_index,
        time_taken_seconds: 0,
        session_key: "excel-question-details",
        created_at: answer.submitted_at || new Date().toISOString(),
      });
    }
    if (!payload.length) continue;

    await supabase.from("test_attempts").delete().eq("test_id", test.id);
    const { error: insErr } = await supabase.from("test_attempts").insert(payload);
    if (insErr) {
      console.error(test.employee_code, insErr.message);
      continue;
    }
    attemptRows += payload.length;
    testsFilled++;
  }
  console.log(`Upserted ${attemptRows} Question Details attempts across ${testsFilled} completed tests`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
