import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import { getOwnedTest } from "@/lib/employee-test-access";
import {
  createEmployeeTestVideoUploadUrl,
} from "@/lib/employee-test-video";
import { syncLocalTestStateToSupabase } from "@/services/employee-test-supabase-sync";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: testId } = await params;
    const auth = await authenticateRequestAsync(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const owned = await getOwnedTest(testId, auth.employeeId);
    if (!owned) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }

    const signed = await createEmployeeTestVideoUploadUrl(testId);
    if (!signed) {
      return NextResponse.json(
        { error: "Could not create upload URL. Use direct upload endpoint instead." },
        { status: 503 }
      );
    }

    return NextResponse.json({
      signedUrl: signed.signedUrl,
      path: signed.path,
      completeUrl: `/api/employee/tests/${testId}/upload_video`,
    });
  } catch (error: any) {
    console.error("Employee test video upload URL failed:", error);
    return NextResponse.json({ error: error.message || "Failed to create upload URL" }, { status: 500 });
  }
}
