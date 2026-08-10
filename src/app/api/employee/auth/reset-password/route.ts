import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/employee-auth";
import fs from "fs";
import path from "path";

// Helper to read the store
const STATIC_ACCOUNT_FILE = path.join(process.cwd(), "src", "data", "employee-accounts.json");
function getAccountFilePath() {
  if (process.env.VERCEL === "1") {
    return "/tmp/employee-accounts.json";
  }
  return STATIC_ACCOUNT_FILE;
}

function readStore() {
  const filePath = getAccountFilePath();
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

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

    const store = readStore();
    const employee = store.employees.find((item: any) => item.employee_id.trim().toUpperCase() === employee_id.toUpperCase());

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

    // Hash and save the password
    const { hash, salt } = hashPassword(password);
    employee.password_hash = hash;
    employee.password_salt = salt;
    employee.is_first_login = false; // ensure they can now log in normally

    // Write back to database
    const filePath = getAccountFilePath();
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");

    return NextResponse.json({ status: "ok", message: "Password reset successful" });
  } catch (error: any) {
    console.error("Employee reset-password API error:", error);
    return NextResponse.json({ error: error.message || "An unexpected error occurred during password reset" }, { status: 500 });
  }
}
