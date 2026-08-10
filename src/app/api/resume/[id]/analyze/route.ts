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
    const analysis = {
      overallScore: 72 + Math.floor(Math.random() * 20),
      atsScore: 68,
      technicalScore: 75,
      communicationScore: 70,
      projectQualityScore: 73,
      impactScore: 69,
      scores: {
        actionVerbs: 65,
        measurability: 60,
        formatting: 80,
        clarity: 72,
        consistency: 75,
        keywordOptimization: 68,
      },
      weaknesses: [
        { category: "content", severity: "high", location: "experience", description: "Bullet points lack measurable achievements", suggestion: "Add quantifiable metrics" },
        { category: "impact", severity: "medium", location: "summary", description: "Professional summary is generic", suggestion: "Rewrite with specifics" },
      ],
      strengths: [
        { category: "skills", description: "Strong technical skills", impact: "high" },
      ],
    };

    resume.analysis = analysis;
    resume.updatedAt = new Date();

    return NextResponse.json({ success: true, analysis });
  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
