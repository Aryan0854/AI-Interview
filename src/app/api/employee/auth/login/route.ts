import { NextRequest, NextResponse } from "next/server";
import { addEmployeeAccountAsync, getEmployeeAccountAsync, hasPassword, verifyPassword, signToken, syncEmployeeToSupabase } from "@/lib/employee-auth";
import { isRateLimited, getClientIp } from "@/lib/security";
import { auditLogService } from "@/services/audit-log-service";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  
  // Rate limit: 10 attempts per minute
  const limitCheck = isRateLimited(`employee_login_${ip}`, 10, 60000);
  if (limitCheck.limited) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again after a minute." },
      { status: 429 }
    );
  }

  let body: any;

  try {
    body = await request.json();
  } catch (error) {
    console.error("Employee login route JSON parse error:", error);
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  try {
    const employee_id = String(body.employee_id ?? "").trim();
    const password = String(body.password ?? "");

    if (!employee_id) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
    }

    let employee = await getEmployeeAccountAsync(employee_id);
    if (!employee) {
      await addEmployeeAccountAsync({
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
      employee = await getEmployeeAccountAsync(employee_id);
    }

    if (!employee || !hasPassword(employee) || employee.is_first_login) {
      await auditLogService.addLog({
        actorEmail: employee?.email || employee_id,
        action: "EMPLOYEE_LOGIN_FIRST_TIME",
        target: "Employee Portal",
        details: "Redirected to set initial password",
        ipAddress: ip
      });
      return NextResponse.json({ status: "first_time", employee: { employee_id: employee_id, full_name: employee?.full_name ?? employee_id } });
    }

    if (!verifyPassword(password, employee.password_salt ?? "", employee.password_hash ?? "")) {
      await auditLogService.addLog({
        actorEmail: employee.email || employee.employee_id,
        action: "EMPLOYEE_LOGIN_FAILURE",
        target: "Employee Portal",
        details: "Invalid password provided",
        ipAddress: ip
      });
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = signToken(employee.employee_id);
    await syncEmployeeToSupabase(employee);

    await auditLogService.addLog({
      actorEmail: employee.email || employee.employee_id,
      action: "EMPLOYEE_LOGIN_SUCCESS",
      target: "Employee Portal",
      details: "Employee logged in and synced successfully",
      ipAddress: ip
    });

    return NextResponse.json({ status: "ok", token, employee: { employee_id: employee.employee_id, full_name: employee.full_name } });
  } catch (e) {
    console.error("Employee login route error:", e);
    return NextResponse.json({ error: "Unable to verify credentials" }, { status: 500 });
  }
}
