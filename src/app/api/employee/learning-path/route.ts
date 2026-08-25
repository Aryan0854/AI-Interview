import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync } from "@/lib/employee-auth";
import { generateLearningPath } from "@/lib/learning-path";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequestAsync(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const path = await generateLearningPath(auth.employeeId);
    return NextResponse.json({ success: true, path });
  } catch (err: any) {
    console.error("Learning path generation error:", err);
    return NextResponse.json({ error: err.message || "Failed to generate learning path" }, { status: 500 });
  }
}
