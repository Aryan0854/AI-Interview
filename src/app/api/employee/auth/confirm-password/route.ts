import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync, completeFirstTimeLoginAsync, saveEmployeePasswordAsync, syncEmployeeToSupabase } from "@/lib/employee-auth";

function validatePassword(password: string) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequestAsync(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized access or expired session." }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  try {
    const action = String(body.action || "keep").toLowerCase();

    if (action === "keep") {
      const updated = await completeFirstTimeLoginAsync(auth.employeeId);
      await syncEmployeeToSupabase(updated || auth.employee);
      return NextResponse.json({
        status: "ok",
        message: "Initial password retained.",
        token: request.headers.get("authorization")?.replace("Bearer ", "") || "",
        employee: { employee_id: auth.employee.employee_id, full_name: auth.employee.full_name }
      });
    }

    if (action === "change") {
      const newPassword = String(body.password || "").trim();
      if (!newPassword) {
        return NextResponse.json({ error: "Please enter a new password." }, { status: 400 });
      }
      if (!validatePassword(newPassword)) {
        return NextResponse.json({ error: "Password must be at least 8 characters long, contain uppercase, lowercase, number, and special character." }, { status: 400 });
      }

      const updated = await saveEmployeePasswordAsync(auth.employeeId, newPassword);
      if (!updated) {
        return NextResponse.json({ error: "Failed to update password." }, { status: 500 });
      }

      await syncEmployeeToSupabase(updated);
      return NextResponse.json({
        status: "ok",
        message: "Password updated successfully.",
        token: request.headers.get("authorization")?.replace("Bearer ", "") || "",
        employee: { employee_id: auth.employee.employee_id, full_name: auth.employee.full_name }
      });
    }

    return NextResponse.json({ error: "Invalid action type." }, { status: 400 });
  } catch (e: any) {
    console.error("Error in confirm-password route:", e);
    return NextResponse.json({ error: e.message || "Failed to process request." }, { status: 500 });
  }
}
