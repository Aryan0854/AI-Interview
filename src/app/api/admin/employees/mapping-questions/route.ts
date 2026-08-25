import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { loadAssignedQuestionsForEmployee } from "@/services/resource-mapping-service";

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const employeeId = new URL(request.url).searchParams.get("employeeId")?.trim();
  if (!employeeId) {
    return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
  }

  try {
    const assigned_questions = await loadAssignedQuestionsForEmployee(employeeId);
    return NextResponse.json({ employeeId, assigned_questions });
  } catch (error: any) {
    console.error("Failed to load assigned questions:", error);
    return NextResponse.json({ error: error.message || "Failed to load questions" }, { status: 500 });
  }
}
