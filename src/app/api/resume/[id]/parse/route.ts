export const runtime = 'nodejs';

import { NextRequest, NextResponse } from "next/server";
import { resumeService } from "@/services/resume-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const resume = await resumeService.getCachedResume(id);

  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    parsed: resume.parsed,
  });
}
