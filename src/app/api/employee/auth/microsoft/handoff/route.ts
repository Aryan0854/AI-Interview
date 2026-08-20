import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/employee-auth";
import { microsoftSsoCookies, ssoCookieOptions } from "@/lib/microsoft-sso";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(microsoftSsoCookies.handoff)?.value || "";
  const employeeId = token ? verifyToken(token) : null;
  const response = NextResponse.json(
    employeeId && token
      ? { status: "ok", token }
      : { error: "Microsoft sign-in session expired. Please try again." },
    { status: employeeId && token ? 200 : 401 }
  );
  response.cookies.set(microsoftSsoCookies.handoff, "", { ...ssoCookieOptions(0), maxAge: 0 });
  return response;
}
