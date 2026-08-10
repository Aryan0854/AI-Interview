import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";

export async function GET(request: NextRequest) {
  if (authenticateAdminRequest(request)) {
    return NextResponse.json({ status: "ok" });
  } else {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
