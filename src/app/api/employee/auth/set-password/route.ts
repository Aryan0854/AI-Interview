import { NextRequest, NextResponse } from "next/server";
import { addEmployeeAccount, getEmployeeAccount, saveEmployeePassword, signToken, syncEmployeeToSupabase } from "@/lib/employee-auth";

function validatePassword(password: string) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

export async function POST(request: NextRequest) {
  let body: any;

  try {
    body = await request.json();
  } catch (error) {
    console.error("Employee set-password route JSON parse error:", error);
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  try {
    const employee_id = String(body.employee_id ?? "").trim();
    const password = String(body.password ?? "");

    if (!employee_id) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
    }
    if (!validatePassword(password)) {
      return NextResponse.json({ error: "Password does not meet the strength requirements" }, { status: 400 });
    }

    let employee = getEmployeeAccount(employee_id);
    if (!employee) {
      addEmployeeAccount({
        employee_id,
        full_name: employee_id,
        email: "",
        department: "",
        role: "employee",
        is_first_login: true,
        password_hash: "",
        password_salt: "",
        xp_points: 0,
        streak_days: 0,
        skill_level: "beginner",
        ai_readiness_score: 0,
      });
      employee = getEmployeeAccount(employee_id);
    }
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    if (!employee.is_first_login) {
      return NextResponse.json({ error: "Password setup has already been completed" }, { status: 400 });
    }

    const saved = saveEmployeePassword(employee.employee_id, password);
    if (!saved) {
      return NextResponse.json({ error: "Failed to save password" }, { status: 500 });
    }

    const token = signToken(employee.employee_id);
    await syncEmployeeToSupabase(employee);
    return NextResponse.json({ status: "ok", token, employee: { employee_id: employee.employee_id, full_name: employee.full_name } });
  } catch (e) {
    console.error("Employee set-password route error:", e);
    return NextResponse.json({ error: "Unable to set password" }, { status: 500 });
  }
}
