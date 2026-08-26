import { supabase } from "@/lib/db";
import { readPersistedBackup, writePersistedBackup } from "@/lib/runtime-data";
import { localTestsDb } from "@/services/local-tests-db";

export type EmployeeTestBackupEvent =
  | "submit"
  | "proctor"
  | "start"
  | "video"
  | "upsert";

function latestPath(testId: string) {
  return `backups/employee-tests/${testId}/latest.json`;
}

function historyPath(testId: string, event: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `backups/employee-tests/${testId}/history/${stamp}-${event}.json`;
}

/**
 * Append-only snapshot of a portal test. Live Employee Portal rows are not changed.
 * Pull latest with GET /api/admin/employee-tests/:testId/backup
 */
export async function snapshotEmployeeTestBackup(
  testId: string,
  event: EmployeeTestBackupEvent
): Promise<void> {
  try {
    const test = await localTestsDb.getTestById(testId);
    if (!test) return;

    const [questions, attempts] = await Promise.all([
      localTestsDb.getQuestions(testId).catch(() => []),
      localTestsDb.getAttempts(testId).catch(() => []),
    ]);

    const snapshot = {
      event,
      savedAt: new Date().toISOString(),
      test,
      questions,
      attempts,
    };
    const serialized = JSON.stringify(snapshot);

    await writePersistedBackup(latestPath(testId), serialized);
    if (event === "submit" || event === "proctor") {
      await writePersistedBackup(historyPath(testId, event), serialized);
    }

    const { error } = await supabase.from("employee_test_backups").insert({
      test_id: testId,
      employee_code: test.employee_id,
      event,
      snapshot,
    });
    if (error && !/does not exist|schema cache|employee_test_backups/i.test(error.message)) {
      console.warn("employee_test_backups insert failed:", error.message);
    }
  } catch (err) {
    console.warn("snapshotEmployeeTestBackup failed:", err);
  }
}

export async function readEmployeeTestBackup(testId: string): Promise<unknown | null> {
  const raw = await readPersistedBackup(latestPath(testId));
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  const { data } = await supabase
    .from("employee_test_backups")
    .select("event, employee_code, snapshot, created_at")
    .eq("test_id", testId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.snapshot ?? data ?? null;
}

/** Never replace a completed live test with pending/in-progress. Video/proctoring may still merge. */
export async function preserveCompletedTestOnUpsert(incoming: {
  id: string;
  status?: string | null;
  session_recording_url?: string | null;
  proctoring?: unknown;
}): Promise<"write" | "skip-status"> {
  const { data: remote } = await supabase
    .from("tests")
    .select("id, status, score_correct, score_percent, completed_at, session_recording_url, proctoring")
    .eq("id", incoming.id)
    .maybeSingle();

  if (remote?.status === "completed" && incoming.status !== "completed") {
    const patch: Record<string, unknown> = {};
    if (incoming.session_recording_url && !remote.session_recording_url) {
      patch.session_recording_url = incoming.session_recording_url;
    }
    if (incoming.proctoring) {
      patch.proctoring = incoming.proctoring;
    }
    if (Object.keys(patch).length) {
      await supabase.from("tests").update(patch).eq("id", incoming.id);
    }
    return "skip-status";
  }
  return "write";
}
