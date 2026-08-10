import { NextRequest, NextResponse } from "next/server";
import { signToken } from "@/lib/employee-auth";
import { isRateLimited, getClientIp } from "@/lib/security";
import { auditLogService } from "@/services/audit-log-service";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  
  // Rate limit check: 5 attempts per minute
  const limitCheck = isRateLimited(`admin_login_${ip}`, 5, 60000);
  if (limitCheck.limited) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again after a minute." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!email.endsWith("@infinite.com")) {
      await auditLogService.addLog({
        actorEmail: email || "unknown",
        action: "ADMIN_LOGIN_FAILURE",
        target: "Admin Console",
        details: "Unauthorized email domain extension",
        ipAddress: ip
      });
      return NextResponse.json(
        { error: "Unauthorized domain. Please enter your @infinite.com email." },
        { status: 400 }
      );
    }

    const adminPassword = process.env.ADMIN_PASSWORD || "12345";
    if (password === adminPassword) {
      // 1 hour session time-bound token
      const token = signToken("admin", 1 * 60 * 60 * 1000);
      
      await auditLogService.addLog({
        actorEmail: email,
        action: "ADMIN_LOGIN_SUCCESS",
        target: "Admin Console",
        details: "Admin session generated successfully",
        ipAddress: ip
      });

      return NextResponse.json({ status: "ok", token });
    } else {
      await auditLogService.addLog({
        actorEmail: email,
        action: "ADMIN_LOGIN_FAILURE",
        target: "Admin Console",
        details: "Invalid password provided",
        ipAddress: ip
      });
      return NextResponse.json({ error: "Invalid Password" }, { status: 401 });
    }
  } catch (error: any) {
    console.error("Admin login API error:", error);
    return NextResponse.json({ error: "Internal server error during login" }, { status: 500 });
  }
}
