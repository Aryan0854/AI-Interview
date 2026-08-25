import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { readEmployeeTestVideo } from "@/lib/employee-test-video";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ testId: string }> }
) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { testId } = await params;
    const fileBuffer = await readEmployeeTestVideo(testId);
    if (!fileBuffer) {
      return NextResponse.json(
        {
          error:
            "Recording not found. The test may have finished before proctoring video was saved — ask the employee to retake after the latest update.",
        },
        { status: 404 }
      );
    }

    const fileSize = fileBuffer.length;
    const range = request.headers.get("range");

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunk = fileBuffer.subarray(start, end + 1);
      return new NextResponse(chunk as any, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunk.length),
          "Content-Type": "video/webm",
          "Content-Disposition": `attachment; filename="${testId}.webm"`,
        },
      });
    }

    return new NextResponse(fileBuffer as any, {
      headers: {
        "Content-Length": String(fileSize),
        "Content-Type": "video/webm",
        "Accept-Ranges": "bytes",
        "Content-Disposition": `attachment; filename="${testId}.webm"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
}
