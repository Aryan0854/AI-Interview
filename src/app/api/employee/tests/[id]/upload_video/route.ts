import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import { saveEmployeeTestVideo } from "@/lib/employee-test-video";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: testId } = await params;
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const test = await localTestsDb.getTestById(testId);
    if (!test || test.employee_id !== auth.employeeId) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("video") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No video file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await saveEmployeeTestVideo(testId, buffer);

    const videoUrl = `/api/admin/employee-tests/${testId}/video`;
    await localTestsDb.updateTest(testId, { session_recording_url: videoUrl });

    return NextResponse.json({ success: true, videoUrl });
  } catch (error: any) {
    console.error("Employee test video upload failed:", error);
    return NextResponse.json({ error: error.message || "Upload failed" }, { status: 500 });
  }
}
