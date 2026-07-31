import { supabase } from "@/lib/db";
import { useSupabasePrimary } from "@/lib/db-mode";
import type { EmployeeAccount } from "@/lib/employee-auth";

const accountCache = new Map<string, EmployeeAccount>();

function mapDbRow(row: Record<string, unknown>): EmployeeAccount {
  return {
    employee_id: String(row.employee_id ?? ""),
    full_name: String(row.full_name ?? row.employee_id ?? ""),
    email: String(row.email ?? ""),
    department: String(row.department ?? "general"),
    role: String(row.role ?? "employee"),
    is_first_login: Boolean(row.is_first_login ?? false),
    password_hash: row.password_hash ? String(row.password_hash) : undefined,
    password_salt: row.password_salt ? String(row.password_salt) : undefined,
    xp_points: typeof row.xp_points === "number" ? row.xp_points : 0,
    streak_days: typeof row.streak_days === "number" ? row.streak_days : 0,
    skill_level: String(row.skill_level ?? "beginner"),
    ai_readiness_score: typeof row.ai_readiness_score === "number" ? row.ai_readiness_score : 0,
    product: row.product ? String(row.product) : undefined,
    product_qb_eligible: Boolean(row.product_qb_eligible ?? false),
    assessment_only: Boolean(row.assessment_only ?? false),
  };
}

export function cacheEmployeeAccount(account: EmployeeAccount) {
  accountCache.set(account.employee_id.trim().toUpperCase(), account);
}

export function getCachedEmployeeAccount(employeeId: string): EmployeeAccount | null {
  return accountCache.get(employeeId.trim().toUpperCase()) ?? null;
}

export async function fetchEmployeeAccountFromDb(
  employeeId: string
): Promise<EmployeeAccount | null> {
  const { data, error } = await supabase
    .from("employees")
    .select(
      "employee_id, full_name, email, department, role, is_first_login, password_hash, password_salt, xp_points, streak_days, skill_level, ai_readiness_score, product, product_qb_eligible, assessment_only"
    )
    .eq("employee_id", employeeId.trim())
    .maybeSingle();

  if (error || !data) return null;
  const account = mapDbRow(data as Record<string, unknown>);
  cacheEmployeeAccount(account);
  return account;
}

export async function fetchEmployeeByEmailFromDb(
  email: string
): Promise<EmployeeAccount | null> {
  const { data, error } = await supabase
    .from("employees")
    .select(
      "employee_id, full_name, email, department, role, is_first_login, password_hash, password_salt, xp_points, streak_days, skill_level, ai_readiness_score, product, product_qb_eligible, assessment_only"
    )
    .ilike("email", email.trim())
    .maybeSingle();

  if (error || !data) return null;
  const account = mapDbRow(data as Record<string, unknown>);
  cacheEmployeeAccount(account);
  return account;
}

export async function upsertEmployeeAccountToDb(
  account: EmployeeAccount
): Promise<boolean> {
  const { error } = await supabase.from("employees").upsert(
    {
      employee_id: account.employee_id,
      email: account.email || `${account.employee_id}@nokia.com`,
      full_name: account.full_name || account.employee_id,
      department: account.department || "general",
      role: account.role || "employee",
      product: account.product ?? null,
      is_first_login: account.is_first_login ?? false,
      password_hash: account.password_hash ?? null,
      password_salt: account.password_salt ?? null,
      product_qb_eligible: account.product_qb_eligible ?? false,
      assessment_only: account.assessment_only ?? false,
      xp_points: account.xp_points ?? 0,
      streak_days: account.streak_days ?? 0,
      skill_level: account.skill_level ?? "beginner",
      ai_readiness_score: account.ai_readiness_score ?? 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "employee_id" }
  );

  if (error) {
    console.error("Failed to upsert employee account:", error.message);
    return false;
  }
  cacheEmployeeAccount(account);
  return true;
}

export function shouldUseDbAccounts(): boolean {
  return useSupabasePrimary();
}
