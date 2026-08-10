/**
 * One-time migration: push local_tests_db.json into Supabase Postgres.
 *
 * Prerequisites:
 *   1. Run docs/supabase-schema/full-schema-and-seed.sql in Supabase SQL Editor
 *   2. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 * Usage:
 *   npx tsx scripts/sync-local-tests-to-supabase.ts
 *   npx tsx scripts/sync-local-tests-to-supabase.ts --file uploads/local_tests_db.json
 *   npx tsx scripts/sync-local-tests-to-supabase.ts --dry-run
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig, loadProjectEnv } from "./load-env";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fileArg = args.find((a) => a.startsWith("--file="));
const sourceFile = fileArg
  ? fileArg.split("=")[1]
  : existsSync(join(ROOT, "uploads", "local_tests_db.json"))
    ? join(ROOT, "uploads", "local_tests_db.json")
    : join(ROOT, "src", "data", "local_tests_db.json");

loadProjectEnv(ROOT);

const { url, key } = getSupabaseConfig();
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  console.error("Ensure .env.local contains NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  console.error(`Looked in: ${join(ROOT, ".env.local")}`);
  process.exit(1);
}

const supabase = createClient(url, key);

interface LocalDB {
  tests: Array<Record<string, unknown>>;
  test_questions: Array<Record<string, unknown>>;
  test_attempts: Array<Record<string, unknown>>;
}

async function resolveEmployeeUuid(employeeCode: string): Promise<string> {
  const { data: existing } = await supabase
    .from("employees")
    .select("id")
    .eq("employee_id", employeeCode)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: inserted, error } = await supabase
    .from("employees")
    .upsert(
      {
        employee_id: employeeCode,
        email: `${employeeCode}@nokia.com`,
        full_name: employeeCode,
        department: "general",
        role: "employee",
      },
      { onConflict: "employee_id" }
    )
    .select("id")
    .single();
  if (error || !inserted?.id) throw error || new Error(`Failed to upsert employee ${employeeCode}`);
  return inserted.id;
}

async function main() {
  console.log(`Reading ${sourceFile}${dryRun ? " (dry run)" : ""}...`);
  const db = JSON.parse(readFileSync(sourceFile, "utf8")) as LocalDB;
  const tests = db.tests ?? [];
  const questions = db.test_questions ?? [];
  const attempts = db.test_attempts ?? [];

  console.log(`Found ${tests.length} tests, ${questions.length} questions, ${attempts.length} attempts`);

  const employeeCache = new Map<string, string>();
  async function empUuid(code: string) {
    if (!employeeCache.has(code)) {
      employeeCache.set(code, await resolveEmployeeUuid(code));
    }
    return employeeCache.get(code)!;
  }

  let testOk = 0;
  for (const test of tests) {
    const employeeCode = String(test.employee_id ?? "");
    if (!employeeCode || !test.id) continue;

    const employeeUuid = await empUuid(employeeCode);
    const row = {
      id: test.id,
      employee_id: employeeUuid,
      employee_code: employeeCode,
      topic_id: test.topic_id,
      subject_id: test.subject_id,
      topic_title: test.topic_title ?? null,
      subject_title: test.subject_title ?? null,
      difficulty: String(test.difficulty ?? "medium"),
      total_questions: test.total_questions ?? 25,
      time_limit_seconds: test.time_limit_seconds ?? 1800,
      status: test.status ?? "pending",
      current_question_index: test.current_question_index ?? 0,
      started_at: test.started_at ?? null,
      completed_at: test.completed_at ?? null,
      in_progress: test.in_progress ?? null,
      session_recording_url: test.session_recording_url ?? null,
      proctoring: test.proctoring ?? null,
      score_correct: test.score_correct ?? null,
      score_total: test.score_total ?? null,
      score_percent: test.score_percent ?? null,
      ai_analysis: test.ai_analysis ?? null,
    };

    if (!dryRun) {
      const { error } = await supabase.from("tests").upsert(row, { onConflict: "id" });
      if (error) {
        console.error(`Test ${test.id} failed:`, error.message);
        continue;
      }
    }
    testOk++;
    if (testOk % 50 === 0) console.log(`  tests: ${testOk}/${tests.length}`);
  }

  console.log(`Upserted ${testOk} tests`);

  const BATCH = 100;
  let qOk = 0;
  for (let i = 0; i < questions.length; i += BATCH) {
    const batch = questions.slice(i, i + BATCH).map((q) => ({
      id: q.id,
      test_id: q.test_id,
      question_index: q.question_index,
      question_text: q.question_text,
      options: q.options,
      correct_option_index: q.correct_option_index,
      explanation: q.explanation ?? "",
      difficulty: String(q.difficulty ?? "medium"),
      topic_id: q.topic_id,
      topic_title: q.topic_title ?? "",
    }));
    if (!dryRun) {
      const { error } = await supabase.from("test_questions").upsert(batch, { onConflict: "id" });
      if (error) {
        console.error(`Questions batch ${i} failed:`, error.message);
        continue;
      }
    }
    qOk += batch.length;
    if (qOk % 500 === 0) console.log(`  questions: ${qOk}/${questions.length}`);
  }
  console.log(`Upserted ${qOk} questions`);

  // Group attempts by test_id — replace per test
  const attemptsByTest = new Map<string, typeof attempts>();
  for (const att of attempts) {
    const tid = String(att.test_id ?? "");
    if (!tid) continue;
    if (!attemptsByTest.has(tid)) attemptsByTest.set(tid, []);
    attemptsByTest.get(tid)!.push(att);
  }

  let attOk = 0;
  for (const [testId, testAttempts] of attemptsByTest) {
    const test = tests.find((t) => t.id === testId);
    if (!test) continue;
    const employeeUuid = await empUuid(String(test.employee_id));

    if (!dryRun) {
      await supabase.from("test_attempts").delete().eq("test_id", testId);
      const payload = testAttempts.map((a) => ({
        test_id: testId,
        employee_id: employeeUuid,
        question_id: a.question_id,
        selected_option_index: a.selected_option_index,
        is_correct: a.is_correct,
        time_taken_seconds: a.time_taken_seconds ?? 0,
        session_key: a.session_key ?? "",
      }));
      const { error } = await supabase.from("test_attempts").insert(payload);
      if (error) {
        console.error(`Attempts for ${testId} failed:`, error.message);
        continue;
      }
    }
    attOk += testAttempts.length;
  }
  console.log(`Inserted ${attOk} attempts across ${attemptsByTest.size} tests`);
  console.log(dryRun ? "Dry run complete — no writes made." : "Migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
