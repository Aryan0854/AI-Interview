/**
 * Upload employee_test_manifest.json from src/data to Supabase app-data (prod).
 * Run: npx tsx scripts/sync-manifest-to-supabase.ts
 */
import { readFile } from "fs/promises";
import { join } from "path";
import "./load-env";
import { supabaseServer } from "../src/lib/db";
import { writePersistedJson } from "../src/lib/runtime-data";

const APP_DATA_BUCKET = "app-data";

async function ensureAppDataBucket() {
  const { data: buckets, error } = await supabaseServer.storage.listBuckets();
  if (error) throw error;
  if (!buckets?.some((b) => b.id === APP_DATA_BUCKET)) {
    await supabaseServer.storage.createBucket(APP_DATA_BUCKET, { public: false });
  }
}

async function main() {
  const source = join(process.cwd(), "src", "data", "employee_test_manifest.json");
  const raw = await readFile(source, "utf8");
  const entries = JSON.parse(raw) as unknown[];
  await writePersistedJson("employee_test_manifest.json", raw);
  await ensureAppDataBucket();
  const { error } = await supabaseServer.storage
    .from(APP_DATA_BUCKET)
    .upload("employee_test_manifest.json", raw, {
      contentType: "application/json",
      upsert: true,
    });
  if (error) throw error;
  console.log(`Synced employee_test_manifest.json (${entries.length} entries) to app-data bucket.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
