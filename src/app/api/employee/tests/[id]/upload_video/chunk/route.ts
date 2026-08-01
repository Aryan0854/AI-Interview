import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { authenticateRequest } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";
import {
  getEmployeeTestVideoAdminUrl,
  saveEmployeeTestVideo,
} from "@/lib/employee-test-video";
import { markProctorVideoUploaded, normalizeProctoring } from "@/lib/employee-proctoring";
import { syncLocalTestStateToSupabase } from "@/services/employee-test-supabase-sync";
import { getRuntimeUploadsRoot } from "@/lib/runtime-data";

export const runtime = "nodejs";
export const maxDuration = 60;

function chunkDir(testId: string) {
  return join(getRuntimeUploadsRoot(), "video_upload_chunks", testId);
}

async function markVideoReady(
  testId: string,
  employee: Parameters<typeof syncLocalTestStateToSupabase>[1]
) {
  const videoUrl = getEmployeeTestVideoAdminUrl(testId);
  const test = await localTestsDb.getTestById(testId);
  const proctoring = markProctorVideoUploaded(normalizeProctoring(test?.proctoring));
  await localTestsDb.updateTest(testId, {
    session_recording_url: videoUrl,
    proctoring,
  });

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
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const test = await localTestsDb.getTestById(testId);
    if (!test || test.employee_id !== auth.employeeId) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const chunkIndex = Number(formData.get("chunkIndex"));
    const totalChunks = Number(formData.get("totalChunks"));
    const chunk = formData.get("chunk");

    if (
      !Number.isInteger(chunkIndex) ||
      !Number.isInteger(totalChunks) ||
      totalChunks < 1 ||
      chunkIndex < 0 ||
      chunkIndex >= totalChunks ||
      !(chunk instanceof Blob)
    ) {
      return NextResponse.json({ error: "Invalid chunk payload" }, { status: 400 });
    }

    const dir = chunkDir(testId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${chunkIndex}.part`),
      Buffer.from(await chunk.arrayBuffer())
    );

    for (let i = 0; i < totalChunks; i++) {
      try {
        await readFile(join(dir, `${i}.part`));
      } catch {
        return NextResponse.json({
          complete: false,
          received: chunkIndex,
          totalChunks,
        });
      }
    }

    const parts: Buffer[] = [];
    for (let i = 0; i < totalChunks; i++) {
      parts.push(await readFile(join(dir, `${i}.part`)));
    }
    const fullBuffer = Buffer.concat(parts);
    if (!fullBuffer.length) {
      return NextResponse.json({ error: "Recording file is empty" }, { status: 400 });
    }

    const saved = await saveEmployeeTestVideo(testId, fullBuffer);
    if (!saved) {
      return NextResponse.json({ error: "Failed to store recording in Supabase" }, { status: 500 });
    }

    const videoUrl = await markVideoReady(testId, auth.employee);

    try {
      const files = await readdir(dir);
      await Promise.all(
        files.map((file) => rm(join(dir, file), { force: true }))
      );
      await rm(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }

    return NextResponse.json({
      complete: true,
      success: true,
      videoUrl,
      bytes: fullBuffer.length,
    });
  } catch (error: any) {
    console.error("Employee test video chunk upload failed:", error);
    return NextResponse.json({ error: error.message || "Chunk upload failed" }, { status: 500 });
  }
}
