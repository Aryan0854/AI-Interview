import { writeFileSync } from "fs";
import { join } from "path";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig, loadProjectEnv } from "./load-env";

const ROOT = process.cwd();
const ANSWERS_XLSX = "C:/Users/Aryan/Downloads/Workbook1.xlsx";
const RESULTS_XLSX = join(ROOT, "employee_portal_test_results_2026-08-19.xlsx");
const OUT_JSON = join(ROOT, "src", "data", "portal-question-answers.json");

loadProjectEnv(ROOT);
const { url, key } = getSupabaseConfig();
const supabase = createClient(url, key);

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object" && "text" in (value as any)) return String((value as any).text ?? "").trim();
  if (typeof value === "object" && "richText" in (value as any)) {
    return ((value as any).richText as Array<{ text?: string }>).map((p) => p.text ?? "").join("").trim();
  }
  return String(value ?? "").trim();
}

function hasSelected(value: string): boolean {
  const t = value.replace(/[—–]/g, "").trim();
  return Boolean(t) && !/^not answered$/i.test(t);
}

function parseOptionIndex(selected: string, options: string[]): number | null {
  const raw = selected.trim();
  const letter = raw.match(/^([A-D])\)/i);
  if (letter) return letter[1].toUpperCase().charCodeAt(0) - 65;
  const stripped = raw.replace(/^[A-D]\)\s*/i, "").trim().toLowerCase();
  const idx = options.findIndex((opt) => String(opt ?? "").trim().toLowerCase().startsWith(stripped.slice(0, 40)));
  return idx >= 0 ? idx : null;
}

function parseSubmittedAt(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)$/i);
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

type Answer = {
  question_index: number;
  question: string;
  selected: string;
  is_correct: boolean | null;
  submitted_at: string | null;
};

async function main() {
  const byEmp = new Map<string, Answer[]>();

  const answersWb = new ExcelJS.Workbook();
  await answersWb.xlsx.readFile(ANSWERS_XLSX);
  const answersSheet = answersWb.worksheets[0];
  answersSheet.eachRow((row, n) => {
    if (n === 1) return;
    const employeeId = cellText(row.getCell(1).value);
    const selected = cellText(row.getCell(5).value);
    if (!employeeId || !hasSelected(selected)) return;
    const result = cellText(row.getCell(6).value).toLowerCase();
    const list = byEmp.get(employeeId) || [];
    list.push({
      question_index: Number(cellText(row.getCell(3).value)) || list.length + 1,
      question: cellText(row.getCell(4).value),
      selected,
      is_correct: result === "correct" ? true : result === "incorrect" ? false : null,
      submitted_at: parseSubmittedAt(cellText(row.getCell(7).value)),
    });
    byEmp.set(employeeId, list);
  });

  const resultsWb = new ExcelJS.Workbook();
  await resultsWb.xlsx.readFile(RESULTS_XLSX);
  const resultsSheet = resultsWb.worksheets[0];
  resultsSheet.eachRow((row, n) => {
    if (n === 1) return;
    if (!/^completed$/i.test(cellText(row.getCell(8).value))) return;
    const employeeId = cellText(row.getCell(2).value);
    if (!employeeId || (byEmp.get(employeeId) || []).length > 0) return;
    const qa = cellText(row.getCell(14).value).replace(/\r\n/g, "\n");
    const chunks = qa.replace(/^Assigned Questions \(\d+\)\s*/i, "").split(/\n\s*\n/).filter(Boolean);
    const list: Answer[] = [];
    for (const chunk of chunks) {
      const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
      const selectedLine = lines.find((l) => /^Selected:/i.test(l)) || "";
      const submittedLine = lines.find((l) => /^Submitted:/i.test(l)) || "";
      const selectedMatch = selectedLine.match(/^Selected:\s*(.*?)\s*(?:\((Correct|Incorrect)\))?\s*$/i);
      const selected = selectedMatch?.[1] || "";
      if (!hasSelected(selected)) continue;
      list.push({
        question_index: list.length + 1,
        question: lines.filter((l) => !/^Selected:/i.test(l) && !/^Submitted:/i.test(l)).join(" "),
        selected,
        is_correct: selectedMatch?.[2]?.toLowerCase() === "correct" ? true : selectedMatch?.[2]?.toLowerCase() === "incorrect" ? false : null,
        submitted_at: parseSubmittedAt(submittedLine.replace(/^Submitted:\s*/i, "")),
      });
    }
    if (list.length) byEmp.set(employeeId, list);
  });

  const overlay: Record<string, Answer[]> = {};
  for (const [id, rows] of byEmp) overlay[id] = rows.sort((a, b) => a.question_index - b.question_index);
  writeFileSync(OUT_JSON, JSON.stringify(overlay, null, 2), "utf8");
  console.log(`Wrote ${Object.keys(overlay).length} employees / ${Object.values(overlay).reduce((s, r) => s + r.length, 0)} answers to portal-question-answers.json`);

  const { data: tests, error } = await supabase
    .from("tests")
    .select("id, employee_id, employee_code")
    .eq("status", "completed");
  if (error) throw error;

  let attemptRows = 0;
  for (const test of tests || []) {
    const answers = overlay[String(test.employee_code)] || [];
    if (!answers.length) continue;
    const { data: questions } = await supabase
      .from("test_questions")
      .select("id, question_index, options, correct_option_index")
      .eq("test_id", test.id);
    const qByIndex = new Map((questions || []).map((q) => [Number(q.question_index), q]));
    const payload = [];
    for (const answer of answers) {
      const q = qByIndex.get(answer.question_index - 1) || qByIndex.get(answer.question_index);
      if (!q) continue;
      const selectedIndex = parseOptionIndex(answer.selected, Array.isArray(q.options) ? q.options : []);
      if (selectedIndex == null) continue;
      payload.push({
        test_id: test.id,
        employee_id: test.employee_id,
        question_id: q.id,
        selected_option_index: selectedIndex,
        is_correct: answer.is_correct ?? selectedIndex === q.correct_option_index,
        time_taken_seconds: 0,
        session_key: "excel-workbook1",
        created_at: answer.submitted_at || new Date().toISOString(),
      });
    }
    await supabase.from("test_attempts").delete().eq("test_id", test.id);
    if (payload.length) {
      const { error: insErr } = await supabase.from("test_attempts").insert(payload);
      if (insErr) console.error(test.employee_code, insErr.message);
      else attemptRows += payload.length;
    }
  }
  console.log(`Upserted ${attemptRows} click-by-click attempts into Supabase`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
