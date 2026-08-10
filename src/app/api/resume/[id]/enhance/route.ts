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

  try {
    const enhanced = {
      summary: "Results-driven professional with proven track record...",
      experience: {},
      projects: {},
      skills: { added: ["AWS", "Docker"], removed: [], reorganized: true },
      suggestions: [
        { type: "modify", section: "summary", priority: "high", description: "Add quantifiable achievements", rationale: "Increases impact by 40%" },
      ],
    };

    resume.enhanced = enhanced;
    resume.updatedAt = new Date();

    return NextResponse.json({ success: true, enhanced });
  } catch (error) {
    console.error("Enhancement error:", error);
    return NextResponse.json({ error: "Enhancement failed" }, { status: 500 });
  }
}
