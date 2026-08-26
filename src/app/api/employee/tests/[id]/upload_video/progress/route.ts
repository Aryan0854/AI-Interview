import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync } from "@/lib/employee-auth";
import { getOwnedTest } from "@/lib/employee-test-access";
import {
  getEmployeeTestVideoAdminUrl,
  saveEmployeeTestVideoProgress,
} from "@/lib/employee-test-video";
import { markProctorVideoUploaded, normalizeProctoring } from "@/lib/employee-proctoring";
import { localTestsDb } from "@/services/local-tests-db";
import { cacheStore } from "@/lib/cache-store";
import { syncLocalTestStateToSupabase } from "@/services/employee-test-supabase-sync";

export const runtime = "nodejs";
export const maxDuration = 120;

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

    const status = owned.test.status ?? "pending";
    if (status !== "in_progress" && status !== "completed") {
      return NextResponse.json({ error: "Recording upload not allowed for this test state." }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get("video") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No video file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.length) {
      return NextResponse.json({ error: "Recording file is empty" }, { status: 400 });
    }

    const saved = await saveEmployeeTestVideoProgress(testId, buffer);
    if (!saved) {
      return NextResponse.json({ error: "Failed to store recording progress" }, { status: 500 });
    }

    const videoUrl = getEmployeeTestVideoAdminUrl(testId);
    const proctoring = markProctorVideoUploaded(normalizeProctoring(owned.test.proctoring));
    await localTestsDb.updateTest(testId, {
      session_recording_url: videoUrl,
      proctoring,
    });

    try {
      await syncLocalTestStateToSupabase(testId, auth.employee);
    } catch (syncErr) {
      console.warn("Failed to sync progress video URL to Supabase:", syncErr);
    }

    cacheStore.invalidate("employees");

    return NextResponse.json({ success: true, bytes: buffer.length, videoUrl });
  } catch (error: any) {
    console.error("Employee test video progress upload failed:", error);
    return NextResponse.json({ error: error.message || "Progress upload failed" }, { status: 500 });
  }
}
