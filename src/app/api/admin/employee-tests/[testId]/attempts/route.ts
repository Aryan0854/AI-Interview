import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { getTestQuestionAttempts } from "@/services/employee-test-attempts-service";
import { localTestsDb } from "@/services/local-tests-db";

export const runtime = "nodejs";

export type { AdminTestQuestionAttempt } from "@/services/employee-test-attempts-service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ testId: string }> }
) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { testId } = await params;
    if (!testId) {
      return NextResponse.json({ error: "Test ID is required" }, { status: 400 });
    }

    const test = await localTestsDb.getTestById(testId);
    if (!test) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }

    const questions = await getTestQuestionAttempts(testId);

    return NextResponse.json({
      success: true,
      testId,
      status: test.status,
      questions: questions ?? [],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load test attempts";
    console.error("Admin test attempts fetch failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
