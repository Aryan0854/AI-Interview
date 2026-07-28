import { isCloudDeployment } from "@/lib/container-runtime";

/**
 * Production uses Supabase Postgres as the single source of truth.
 * Local JSON is dev/offline fallback only when explicitly allowed.
 */
export function useSupabasePrimary(): boolean {
  return isCloudDeployment();
}

export function allowLocalTestsFallback(): boolean {
  if (useSupabasePrimary()) return false;
  return process.env.DISABLE_LOCAL_TESTS_FALLBACK !== "1";
}

export function requireProductionSecrets(): void {
  if (useSupabasePrimary() && !process.env.EMPLOYEE_AUTH_SECRET) {
    throw new Error("EMPLOYEE_AUTH_SECRET must be set in production");
  }
}
