/**
 * Upload employee_test_manifest.json from src/data to Supabase app-data (prod).
 * Run: npx tsx scripts/sync-manifest-to-supabase.ts
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig, loadProjectEnv } from "./load-env";

const ROOT = process.cwd();
loadProjectEnv(ROOT);

const { url, key } = getSupabaseConfig();
if (!url || !key) {
  console.error("Missing Supabase env vars.");
  console.error("Ensure .env.local contains NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  console.error(`Looked in: ${join(ROOT, ".env.local")}`);
  process.exit(1);
}

const supabase = createClient(url, key);
const APP_DATA_BUCKET = "app-data";

async function ensureAppDataBucket() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  if (!buckets?.some((b) => b.id === APP_DATA_BUCKET)) {
    const { error: createErr } = await supabase.storage.createBucket(APP_DATA_BUCKET, {
      public: false,
    });
    if (createErr) throw createErr;
  }
}

async function main() {
  const source = join(ROOT, "src", "data", "employee_test_manifest.json");
  const raw = await readFile(source, "utf8");
  const entries = JSON.parse(raw) as unknown[];

  const uploadsDir = join(ROOT, "uploads");
  await mkdir(uploadsDir, { recursive: true });
  await writeFile(join(uploadsDir, "employee_test_manifest.json"), raw, "utf8");

  await ensureAppDataBucket();
  const { error } = await supabase.storage
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
