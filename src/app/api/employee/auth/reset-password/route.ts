import { NextRequest, NextResponse } from "next/server";
import { getEmployeeAccount, saveEmployeePassword, syncEmployeeToSupabase } from "@/lib/employee-auth";

function validatePassword(password: string) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const employee_id = String(body.employee_id ?? "").trim();
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");

    if (!employee_id) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
    }

    const employee = getEmployeeAccount(employee_id);

    if (!employee) {
      return NextResponse.json({ error: "Employee ID not found" }, { status: 404 });
    }

    // Enforce email check if employee has an email registered
    if (employee.email) {
      if (!email || employee.email.toLowerCase().trim() !== email.toLowerCase().trim()) {
        return NextResponse.json({ error: "Provided email does not match our records for this Employee ID" }, { status: 400 });
      }
    }

    // Validate new password strength
    if (!validatePassword(password)) {
      return NextResponse.json({ error: "Password does not meet the strength requirements (Min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char)" }, { status: 400 });
    }

    // Hash, save (also clears is_first_login so they can log in normally), and sync
    // the updated record to Supabase so the admin portal reflects it immediately.
    const updated = saveEmployeePassword(employee.employee_id, password);
    if (!updated) {
      return NextResponse.json({ error: "Failed to reset password" }, { status: 500 });
    }
    await syncEmployeeToSupabase(updated);

    return NextResponse.json({ status: "ok", message: "Password reset successful" });
  } catch (error: any) {
    console.error("Employee reset-password API error:", error);
    return NextResponse.json({ error: error.message || "An unexpected error occurred during password reset" }, { status: 500 });
  }
}
