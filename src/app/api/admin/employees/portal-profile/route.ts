import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { supabase } from "@/lib/db";
import { useSupabasePrimary } from "@/lib/db-mode";
import { writeLog } from "@/lib/structured-logger";
import { cacheStore } from "@/lib/cache-store";
import {
  saveResourcePortalProfileEdit,
  deleteResourcePortalProfile,
} from "@/services/resource-mapping-service";
import {
  fetchEmployeeAccountFromDb,
  upsertEmployeeAccountToDb,
  shouldUseDbAccounts,
} from "@/services/employee-account-store";

const ACCOUNTS_FILE = join(process.cwd(), "src", "data", "employee-accounts.json");

type EditableFields = {
  full_name?: string;
  role?: string;
  domain?: string;
  product?: string;
  email?: string;
  ddh?: string;
  emp_status?: string;
  remarks?: string;
};

function pickEditableFields(body: any): EditableFields {
  const out: EditableFields = {};
  for (const key of ["full_name", "role", "domain", "product", "email", "ddh", "emp_status", "remarks"] as const) {
    if (typeof body[key] === "string") {
      out[key] = body[key].trim();
    }
  }
  return out;
}

/** Best-effort update of the underlying login/identity record (Supabase employees table,
 * falling back to the local accounts JSON in dev), so identity fields like name/email
 * don't get silently overridden by the un-edited base account on the next roster load. */
async function updateAccountIdentity(employeeId: string, edits: EditableFields) {
  const identityPatch: Record<string, unknown> = {};
  if (edits.full_name !== undefined) identityPatch.full_name = edits.full_name;
  if (edits.email !== undefined) identityPatch.email = edits.email;
  if (edits.role !== undefined) identityPatch.role = edits.role;
  if (edits.domain !== undefined) identityPatch.department = edits.domain;
  if (edits.product !== undefined) identityPatch.product = edits.product;

  if (Object.keys(identityPatch).length === 0) return;

  if (shouldUseDbAccounts()) {
    const existing = await fetchEmployeeAccountFromDb(employeeId);
    if (existing) {
      await upsertEmployeeAccountToDb({
        ...existing,
        full_name: (identityPatch.full_name as string) ?? existing.full_name,
        email: (identityPatch.email as string) ?? existing.email,
        role: (identityPatch.role as string) ?? existing.role,
        department: (identityPatch.department as string) ?? existing.department,
        product: (identityPatch.product as string) ?? existing.product,
      });
      return;
    }
  }

  // Dev/local fallback: patch the accounts JSON file directly.
  try {
    const raw = await readFile(ACCOUNTS_FILE, "utf8");
    const store = JSON.parse(raw) as { employees?: any[] };
    const list = store.employees ?? [];
    const idx = list.findIndex((e) => String(e.employee_id) === employeeId);
    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        full_name: (identityPatch.full_name as string) ?? list[idx].full_name,
        email: (identityPatch.email as string) ?? list[idx].email,
        role: (identityPatch.role as string) ?? list[idx].role,
        department: (identityPatch.department as string) ?? list[idx].department,
        product: (identityPatch.product as string) ?? list[idx].product,
      };
      store.employees = list;
      await writeFile(ACCOUNTS_FILE, JSON.stringify(store, null, 2), "utf8");
    }
  } catch {
    // No local accounts file present (e.g. production without DB accounts configured) —
    // the resource_portal_profiles.json overlay written by the caller is the fallback.
  }
}

/**
 * PATCH /api/admin/employees/portal-profile
 * Edits an Employee Portal account's profile fields. Gated client-side by the supervisor
 * password modal, same as the existing candidate/employee delete flows.
 */
export async function PATCH(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let employeeId = "";
  try {
    const body = await request.json().catch(() => ({}));
    employeeId = String(body.employeeId ?? "").trim();
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
    }

    const edits = pickEditableFields(body);
    if (Object.keys(edits).length === 0) {
      return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
    }

    await updateAccountIdentity(employeeId, edits);
    await saveResourcePortalProfileEdit(employeeId, edits);

    cacheStore.invalidate("employees");

    await writeLog(
      "employee",
      "ADMIN_EDIT_PORTAL_EMPLOYEE",
      "success",
      `Admin edited portal employee ${employeeId}: ${Object.keys(edits).join(", ")}`
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    await writeLog(
      "employee",
      "ADMIN_EDIT_PORTAL_EMPLOYEE_FAILED",
      "failed",
      `Admin edit of portal employee ${employeeId || "unknown"} failed: ${error.message}`
    );
    return NextResponse.json({ error: error.message || "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/employees/portal-profile
 * Removes an Employee Portal account entirely (login, tests via cascade, and the profile
 * overlay), and records the id so it never reappears from the read-only Excel mapping.
 */
export async function DELETE(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let employeeId = "";
  try {
    const body = await request.json().catch(() => ({}));
    employeeId = String(body.employeeId ?? "").trim();
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
    }

    if (shouldUseDbAccounts()) {
      const { error: dbError } = await supabase.from("employees").delete().eq("employee_id", employeeId);
      if (dbError) {
        console.warn("Failed to delete portal employee from Supabase:", dbError.message);
      }
    }

    // Dev/local fallback: remove from the accounts JSON file too.
    try {
      const raw = await readFile(ACCOUNTS_FILE, "utf8");
      const store = JSON.parse(raw) as { employees?: any[] };
      const list = (store.employees ?? []).filter((e) => String(e.employee_id) !== employeeId);
      store.employees = list;
      await writeFile(ACCOUNTS_FILE, JSON.stringify(store, null, 2), "utf8");
    } catch {
      // No local accounts file — fine, DB (or the removed-ids list) is the source of truth.
    }

    await deleteResourcePortalProfile(employeeId);

    cacheStore.invalidate("employees");

    await writeLog(
      "employee",
      "ADMIN_DELETE_PORTAL_EMPLOYEE",
      "success",
      `Admin deleted portal employee ${employeeId}`
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    await writeLog(
      "employee",
      "ADMIN_DELETE_PORTAL_EMPLOYEE_FAILED",
      "failed",
      `Admin delete of portal employee ${employeeId || "unknown"} failed: ${error.message}`
    );
    return NextResponse.json({ error: error.message || "Internal error" }, { status: 500 });
  }
}
