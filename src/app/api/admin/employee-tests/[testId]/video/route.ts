import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import {
  employeeTestVideoExists,
  getEmployeeTestVideoPublicUrl,
  readEmployeeTestVideo,
} from "@/lib/employee-test-video";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ testId: string }> }
) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { testId } = await params;
    const requestedName = request.nextUrl.searchParams.get("filename");
    const inline = request.nextUrl.searchParams.get("inline") === "1";
    const safeName =
      requestedName && /^[\w.\- ()]+$/i.test(requestedName) && requestedName.toLowerCase().endsWith(".webm")
        ? requestedName
        : `${testId}.webm`;

    // Large recordings: redirect inline playback to Supabase CDN (native range requests).
    if (inline && request.nextUrl.searchParams.get("cdn") === "1") {
      const exists = await employeeTestVideoExists(testId);
      const publicUrl = getEmployeeTestVideoPublicUrl(testId);
      if (exists && publicUrl) {
        return NextResponse.redirect(publicUrl, { status: 302 });
      }
    }

    const fileBuffer = await readEmployeeTestVideo(testId);
    if (!fileBuffer) {
      return NextResponse.json(
        {
          error:
            "Recording not found or invalid. The test may have finished before video was saved — ask the employee to retake after confirming camera access.",
        },
        { status: 404 }
      );
    }

    const disposition = inline
      ? `inline; filename="${safeName}"`
      : `attachment; filename="${safeName}"`;
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
          "Content-Type": "video/webm; codecs=vp8",
          "Content-Disposition": disposition,
          "Cache-Control": "private, max-age=3600",
        },
      });
    }

    return new NextResponse(fileBuffer as any, {
      headers: {
        "Content-Length": String(fileSize),
        "Content-Type": "video/webm; codecs=vp8",
        "Accept-Ranges": "bytes",
        "Content-Disposition": disposition,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
}
