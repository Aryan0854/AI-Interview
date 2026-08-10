import { NextRequest, NextResponse } from "next/server";
import { addEmployeeAccount, getEmployeeAccount, getEmployeeByEmail, signToken } from "@/lib/employee-auth";

export async function POST(request: NextRequest) {
  let body: any;

  try {
    body = await request.json();
  } catch (error) {
    console.error("Outlook SSO route JSON parse error:", error);
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  try {
    const email = String(body.email ?? "").trim();

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email address is required for SSO" }, { status: 400 });
    }

    let employee = getEmployeeByEmail(email);
    
    // Auto-provision a new employee record if the email isn't registered yet!
    if (!employee) {
      const employee_id = "EMP" + Math.floor(1000 + Math.random() * 9000);
      const full_name = email.split("@")[0].split(".").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      
      const success = addEmployeeAccount({
        employee_id,
        full_name,
        email,
        department: "engineering",
        role: "employee",
        is_first_login: false,
        xp_points: 0,
        streak_days: 0,
        skill_level: "beginner",
        ai_readiness_score: 0,
      });

      if (!success) {
        throw new Error("Failed to auto-provision employee record");
      }

      employee = getEmployeeAccount(employee_id);
    }

    if (!employee) {
      return NextResponse.json({ error: "Failed to retrieve employee account" }, { status: 500 });
    }

    const token = signToken(employee.employee_id);
    return NextResponse.json({ 
      status: "ok", 
      token, 
      employee: { 
        employee_id: employee.employee_id, 
        full_name: employee.full_name,
        email: employee.email
      } 
    });
  } catch (e: any) {
    console.error("Outlook SSO auth route error:", e);
    return NextResponse.json({ error: e.message || "SSO Authentication Failed" }, { status: 500 });
  }
}
