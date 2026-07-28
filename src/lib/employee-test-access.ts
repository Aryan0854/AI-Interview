import { supabase } from "@/lib/db";
import { localTestsDb } from "@/services/local-tests-db";

export function normalizeEmployeeId(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function employeeOwnsTest(
  test: { employee_id?: string | null; employee_code?: string | null },
  employeeCode: string,
  employeeUuid?: string
): boolean {
  const code = normalizeEmployeeId(employeeCode);
  const uuid = normalizeEmployeeId(employeeUuid);
  const owner = normalizeEmployeeId(test.employee_id);
  const ownerCode = normalizeEmployeeId(test.employee_code);
  return owner === code || owner === uuid || ownerCode === code;
}

export async function getEmployeeUuid(employeeCode: string): Promise<string> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeCode);
  if (isUuid) return employeeCode;

  const { data } = await supabase
    .from("employees")
    .select("id")
    .eq("employee_id", employeeCode)
    .maybeSingle();
  return data?.id ?? employeeCode;
}

export async function getOwnedTest(testId: string, employeeCode: string) {
  const employeeUuid = await getEmployeeUuid(employeeCode);
  const test = await localTestsDb.getTestById(testId);
  if (!test || !employeeOwnsTest(test as any, employeeCode, employeeUuid)) {
    return null;
  }
  return { test, employeeUuid };
}
