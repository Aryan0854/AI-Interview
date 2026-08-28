import { supabaseServer } from "@/lib/db";

const SETTINGS_KEY = "corp_pool_roster";

type CorpPoolRow = {
  employee_id: string;
  [key: string]: unknown;
};

let cache: { at: number; value: CorpPoolRow[] } | null = null;

function asEmployeeList(raw: unknown): CorpPoolRow[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { employees?: unknown }).employees)
      ? (raw as { employees: unknown[] }).employees
      : [];
  const seen = new Set<string>();
  const out: CorpPoolRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const emp = row as CorpPoolRow;
    const id = String(emp.employee_id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...emp, employee_id: id });
  }
  return out;
}

export async function loadCorpPoolRoster<T extends { employee_id: string }>(): Promise<T[]> {
  if (cache && Date.now() - cache.at < 4000) return cache.value as T[];
  try {
    const { data, error } = await supabaseServer
      .from("portal_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (error) {
      console.warn("Failed to load Corp Pool roster from DB:", error.message);
      return (cache?.value ?? []) as T[];
    }
    const value = asEmployeeList(data?.value);
    cache = { at: Date.now(), value };
    return value as T[];
  } catch (err) {
    console.warn("Failed to load Corp Pool roster from DB:", err);
    return (cache?.value ?? []) as T[];
  }
}

export async function saveCorpPoolRoster(employees: Array<{ employee_id: string }>): Promise<void> {
  const value = asEmployeeList(employees);
  cache = { at: Date.now(), value };
  const { error } = await supabaseServer.from("portal_settings").upsert(
    {
      key: SETTINGS_KEY,
      value: { employees: value },
    },
    { onConflict: "key" }
  );
  if (error) {
    throw new Error(`Failed to save Corp Pool to database: ${error.message}`);
  }
}
