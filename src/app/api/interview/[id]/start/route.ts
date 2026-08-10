export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    if (!id) {
      return NextResponse.json(
        { status: "error", message: "Interview ID is required" },
        { status: 400 }
      );
    }

    // Update the candidate_interview_data to mark interview as started
    let dbSuccess = false;
    let responseData: any = null;

    try {
      const { data, error } = await supabase
        .from('candidate_interview_data')
        .update({
          interview_started_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select();

      if (!error && data && data.length > 0) {
        dbSuccess = true;
        responseData = data;
      } else if (error) {
        console.warn("Supabase candidate_interview_data update error (falling back):", error.message);
      }
    } catch (dbErr: any) {
      console.warn("Failed to update candidate_interview_data table:", dbErr.message || dbErr);
    }

    if (!dbSuccess) {
      // Fallback: Update resumes table report.interviewStartedAt
      try {
        const { resumeService } = await import('@/services/resume-service');
        const resume = await resumeService.getCachedResume(id, true);
        if (resume) {
          resume.report = {
            ...(resume.report || {}),
            interviewStartedAt: new Date().toISOString()
          } as any;
          await resumeService.saveResumeRow(resume);
          console.log("Successfully marked interview as started in resumes table report fallback.");
          responseData = { id: resume.id, interview_started_at: resume.report.interviewStartedAt };
        } else {
          console.warn("Could not find resume record to mark as started.");
        }
      } catch (fallbackErr: any) {
        console.error("Fallback marking interview as started failed:", fallbackErr.message || fallbackErr);
      }
    }

    return NextResponse.json({
      status: "success",
      data: responseData
    });
  } catch (err: any) {
    console.error("Interview start endpoint error:", err);
    return NextResponse.json(
      { status: "error", message: err.message },
      { status: 500 }
    );
  }
}
