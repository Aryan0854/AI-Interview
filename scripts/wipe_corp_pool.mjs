import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

if (process.env.ALLOW_INSECURE_TLS === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const EMPTY = "[]\n";

function wipeDir(dir) {
  if (!existsSync(dir)) {
    console.log("skip missing", dir);
    return 0;
  }
  const names = readdirSync(dir);
  let n = 0;
  for (const name of names) {
    if (name === ".gitkeep") continue;
    rmSync(join(dir, name), { recursive: true, force: true });
    n += 1;
  }
  console.log(`wiped ${n} item(s) from ${dir}`);
  return n;
}

async function main() {
  mkdirSync("uploads", { recursive: true });
  writeFileSync("uploads/employees.json", EMPTY, "utf8");
  console.log("wrote empty uploads/employees.json");
  wipeDir("docs/Corp Pool");
  wipeDir("uploads/docs-cache/Corp Pool");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.log("No Supabase credentials; skipped cloud wipe.");
    return;
  }

  const supabase = createClient(url, key);

  const { error: jsonError } = await supabase.storage
    .from("app-data")
    .upload("employees.json", EMPTY, { contentType: "application/json", upsert: true });
  console.log(jsonError ? `app-data employees.json failed: ${jsonError.message}` : "cleared app-data/employees.json");

  const { data: files, error: listError } = await supabase.storage
    .from("docs-ingest")
    .list("Corp Pool", { limit: 1000 });
  if (listError) {
    console.log("list Corp Pool failed:", listError.message);
  } else {
    const paths = (files || [])
      .map((f) => f?.name)
      .filter(Boolean)
      .map((name) => `Corp Pool/${name}`);
    if (paths.length) {
      const { error: removeError } = await supabase.storage.from("docs-ingest").remove(paths);
      console.log(
        removeError
          ? `remove Corp Pool files failed: ${removeError.message}`
          : `removed ${paths.length} cloud Corp Pool file(s)`
      );
    } else {
      console.log("no cloud Corp Pool files");
    }
  }

  const { error: settingsError } = await supabase.from("portal_settings").upsert(
    { key: "deleted_corp_pool", value: { ids: [], files: [] } },
    { onConflict: "key" }
  );
  console.log(
    settingsError
      ? `reset deleted_corp_pool failed: ${settingsError.message}`
      : "reset deleted_corp_pool tombstones"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
