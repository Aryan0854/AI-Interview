import { isCloudDeployment } from "@/lib/container-runtime";

function hasSupabaseCredentials(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";
  return Boolean(url.startsWith("http") && key);
}

/**
 * Production / explicit cloud mode: Supabase-only for accounts & tests.
 * Locally, credentials alone do not force this (keeps offline test tooling).
 */
export function useSupabasePrimary(): boolean {
  if (process.env.USE_SUPABASE_PRIMARY === "0") return false;
  return isCloudDeployment() || process.env.USE_SUPABASE_PRIMARY === "1";
}

export function allowLocalTestsFallback(): boolean {
  if (useSupabasePrimary()) return false;
  return process.env.DISABLE_LOCAL_TESTS_FALLBACK !== "1";
}

/**
 * Local uploads/*.json for JDs, resumes, employees, emails.
 * When Supabase credentials exist, local JSON is off unless ALLOW_LOCAL_DATA_FALLBACK=1.
 */
export function allowLocalDataFallback(): boolean {
  if (process.env.ALLOW_LOCAL_DATA_FALLBACK === "1") return true;
  if (useSupabasePrimary() || hasSupabaseCredentials()) return false;
  return process.env.DISABLE_LOCAL_DATA_FALLBACK !== "1";
}

export function requireProductionSecrets(): void {
  if (useSupabasePrimary() && !process.env.EMPLOYEE_AUTH_SECRET) {
    throw new Error("EMPLOYEE_AUTH_SECRET must be set in production");
  }
}
