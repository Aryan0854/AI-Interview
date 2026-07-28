import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import { getOwnedTest } from "@/lib/employee-test-access";
import {
  employeeTestVideoStoragePath,
  getEmployeeTestVideoAdminUrl,
  saveEmployeeTestVideo,
} from "@/lib/employee-test-video";
import { syncLocalTestStateToSupabase } from "@/services/employee-test-supabase-sync";
import { supabaseServer } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

async function markVideoReady(
  testId: string,
  employee: Parameters<typeof syncLocalTestStateToSupabase>[1]
) {
  const videoUrl = getEmployeeTestVideoAdminUrl(testId);
  await localTestsDb.updateTest(testId, { session_recording_url: videoUrl });

  try {
    await syncLocalTestStateToSupabase(testId, employee);
  } catch (syncErr) {
    console.warn("Failed to sync video URL to Supabase:", syncErr);
  }

  return videoUrl;
}

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

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      if (body?.complete === true) {
        const path = employeeTestVideoStoragePath(testId);
        const { data, error } = await supabaseServer.storage.from("recordings").download(path);
        if (error || !data) {
          return NextResponse.json(
            { error: "Recording file not found in storage after upload." },
            { status: 404 }
          );
        }
        const buffer = Buffer.from(await data.arrayBuffer());
        if (!buffer.length) {
          return NextResponse.json({ error: "Recording file is empty." }, { status: 400 });
        }

        const videoUrl = await markVideoReady(testId, auth.employee);
        return NextResponse.json({ success: true, videoUrl });
      }
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

    const saved = await saveEmployeeTestVideo(testId, buffer);
    if (!saved) {
      return NextResponse.json({ error: "Failed to store recording" }, { status: 500 });
    }

    const videoUrl = await markVideoReady(testId, auth.employee);
    return NextResponse.json({ success: true, videoUrl });
  } catch (error: any) {
    console.error("Employee test video upload failed:", error);
    return NextResponse.json({ error: error.message || "Upload failed" }, { status: 500 });
  }
}
