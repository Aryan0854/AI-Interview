import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { getAdminAccess } from "@/lib/admin-accounts-server";

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() || "";
  if (!email) {
    return NextResponse.json({ status: "ok" });
  }

  const access = await getAdminAccess(email);
  return NextResponse.json({
    status: "ok",
    email: access.email,
    canViewEmployeePortal: access.canViewEmployeePortal,
    canChangePassword: access.canChangePassword,
  });
}
