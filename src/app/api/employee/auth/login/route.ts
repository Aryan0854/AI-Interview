import { NextRequest, NextResponse } from "next/server";
import { getEmployeeAccountAsync, hasPassword, verifyPassword, signToken, syncEmployeeToSupabase } from "@/lib/employee-auth";
import { cacheEmployeeAccount } from "@/services/employee-account-store";
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
    const password = String(body.password ?? "").trim();

    if (!employee_id) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
    }

    const employee = await getEmployeeAccountAsync(employee_id);
    if (!employee) {
      return NextResponse.json({ error: "Invalid Employee ID" }, { status: 401 });
    }

    const isHashValid = hasPassword(employee) && verifyPassword(password, employee.password_salt ?? "", employee.password_hash ?? "");
    const isFirstLogin = employee.is_first_login ?? (!hasPassword(employee));
    const isBlankPassword = password === "";
    const isEmpIdAsPassword = password.toUpperCase() === employee.employee_id.trim().toUpperCase();

    const isAllowedFirstTime = isFirstLogin && (isBlankPassword || isEmpIdAsPassword || isHashValid);

    if (!isHashValid && !isAllowedFirstTime) {
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
    cacheEmployeeAccount(employee);
    await syncEmployeeToSupabase(employee);

    if (isFirstLogin) {
      await auditLogService.addLog({
        actorEmail: employee.email || employee.employee_id,
        action: "EMPLOYEE_LOGIN_FIRST_TIME_SUCCESS",
        target: "Employee Portal",
        details: "First time login with initial or blank password. Prompting to keep or change password.",
        ipAddress: ip
      });
      return NextResponse.json({
        status: "first_time_modal",
        token,
        employee: { employee_id: employee.employee_id, full_name: employee.full_name }
      });
    }

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
