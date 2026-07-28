/**
 * Import employee login credentials from employee-accounts.json into Supabase.
 *
 * Prerequisites: run docs/supabase-schema/migrate-to-production.sql first.
 *
 * Usage: npx tsx scripts/sync-employee-accounts-to-supabase.ts
 */
import { readFileSync } from "fs";
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

type SchemaMode = "full" | "core";

async function detectSchemaMode(): Promise<SchemaMode> {
  const probe = {
    employee_id: "__schema_probe__",
    email: "probe@example.com",
    full_name: "probe",
    department: "general",
    role: "employee",
    product: null,
    password_hash: null,
    password_salt: null,
    product_qb_eligible: false,
    assessment_only: false,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("employees").upsert(probe, { onConflict: "employee_id" });
  await supabase.from("employees").delete().eq("employee_id", "__schema_probe__");

  if (error?.message?.includes("schema cache") || error?.message?.includes("column")) {
    console.warn(
      "Extended employee columns missing — run docs/supabase-schema/migrate-to-production.sql in Supabase SQL Editor."
    );
    console.warn("Syncing core profile fields only (no passwords until migration is applied).\n");
    return "core";
  }
  return "full";
}

function buildRow(emp: Record<string, unknown>, mode: SchemaMode) {
  const base = {
    employee_id: emp.employee_id,
    email: emp.email || `${emp.employee_id}@nokia.com`,
    full_name: emp.full_name || emp.employee_id,
    department: emp.department || "general",
    role: emp.role || "employee",
    is_first_login: emp.is_first_login ?? false,
    updated_at: new Date().toISOString(),
  };

  if (mode === "core") return base;

  return {
    ...base,
    product: emp.product ?? null,
    password_hash: emp.password_hash ?? null,
    password_salt: emp.password_salt ?? null,
    product_qb_eligible: emp.product_qb_eligible ?? false,
    assessment_only: emp.assessment_only ?? false,
  };
}

async function main() {
  const file = join(ROOT, "src", "data", "employee-accounts.json");
  const store = JSON.parse(readFileSync(file, "utf8")) as {
    employees: Array<Record<string, unknown>>;
  };

  const mode = await detectSchemaMode();
  const BATCH = 50;
  let ok = 0;

  for (let i = 0; i < store.employees.length; i += BATCH) {
    const batch = store.employees.slice(i, i + BATCH).map((emp) => buildRow(emp, mode));
    const { error } = await supabase.from("employees").upsert(batch, { onConflict: "employee_id" });
    if (error) {
      console.error(`Batch ${i} failed:`, error.message);
    } else {
      ok += batch.length;
      if (ok % 200 === 0 || ok === store.employees.length) {
        console.log(`  synced ${ok}/${store.employees.length}...`);
      }
    }
  }

  console.log(`Synced ${ok}/${store.employees.length} employee accounts to Supabase (${mode} schema).`);
  if (mode === "core") {
    console.log("\nNext: run migrate-to-production.sql, then re-run this script for passwords.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
