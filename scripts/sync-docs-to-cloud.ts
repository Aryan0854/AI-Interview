/**
 * Upload local docs/ folders to Supabase docs-ingest bucket (one-time prod setup).
 * Run: npx tsx scripts/sync-docs-to-cloud.ts
 */
import { join } from "path";
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

// Must set env before any module imports src/lib/db.ts (reads env at load time).
process.env.NEXT_PUBLIC_SUPABASE_URL = url;
process.env.SUPABASE_SERVICE_ROLE_KEY = key;
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key;
}
process.env.DOCS_USE_CLOUD = "1";

async function main() {
  const { syncLocalDocsToCloud } = await import("../src/lib/docs-storage");
  const { uploaded } = await syncLocalDocsToCloud();
  console.log(`Uploaded ${uploaded} files to docs-ingest bucket.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
