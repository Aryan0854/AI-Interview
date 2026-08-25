import { existsSync, readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

if (process.env.ALLOW_INSECURE_TLS === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("No Supabase credentials; cannot sync Corp Pool to cloud.");
  process.exit(1);
}

const supabase = createClient(url, key);
const jsonPath = "uploads/employees.json";
const xlsxPath = "uploads/docs-cache/Corp Pool/Corp Pool Active List 18th Aug_26.xlsx";

async function main() {
  if (!existsSync(jsonPath)) {
    throw new Error(`Missing ${jsonPath}`);
  }
  const json = readFileSync(jsonPath, "utf8");
  const parsed = JSON.parse(json);
  const count = Array.isArray(parsed) ? parsed.length : 0;
  console.log(`local employees.json count: ${count}`);

  const { error: jsonError } = await supabase.storage
    .from("app-data")
    .upload("employees.json", json, { contentType: "application/json", upsert: true });
  if (jsonError) throw new Error(`app-data/employees.json: ${jsonError.message}`);
  console.log("uploaded app-data/employees.json");

  if (!existsSync(xlsxPath)) {
    throw new Error(`Missing ${xlsxPath}`);
  }
  const buf = readFileSync(xlsxPath);
  const { error: xlsxError } = await supabase.storage
    .from("docs-ingest")
    .upload("Corp Pool/Corp Pool Active List 18th Aug_26.xlsx", buf, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });
  if (xlsxError) throw new Error(`docs-ingest Corp Pool xlsx: ${xlsxError.message}`);
  console.log("uploaded docs-ingest/Corp Pool/Corp Pool Active List 18th Aug_26.xlsx");

  const { data: resumes, error: listError } = await supabase.storage
    .from("docs-ingest")
    .list("Resumes", { limit: 1000 });
  if (listError) {
    console.log("list Resumes failed:", listError.message);
    return;
  }
  const misfiled = (resumes || []).filter((f) => /corp pool|active list/i.test(f?.name || ""));
  if (!misfiled.length) {
    console.log("no misfiled Corp Pool files in Resumes");
    return;
  }
  const paths = misfiled.map((f) => `Resumes/${f.name}`);
  const { error: removeError } = await supabase.storage.from("docs-ingest").remove(paths);
  if (removeError) throw new Error(`remove misfiled: ${removeError.message}`);
  console.log(`removed misfiled Resumes file(s): ${paths.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
