/**
 * Upload local docs/ folders to Supabase docs-ingest bucket (one-time prod setup).
 * Run: npx tsx scripts/sync-docs-to-cloud.ts
 */
process.env.DOCS_USE_CLOUD = "1";

import "./load-env";

async function main() {
  const { syncLocalDocsToCloud } = await import("../src/lib/docs-storage");
  const { uploaded } = await syncLocalDocsToCloud();
  console.log(`Uploaded ${uploaded} files to docs-ingest bucket.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
