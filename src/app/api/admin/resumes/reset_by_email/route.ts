export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resumeService } from '@/services/resume-service';
import { sessionService } from '@/services/session-service';
import { supabase } from '@/lib/db';
import { resetLogService } from '@/services/reset-log-service';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { writeLog } from '@/lib/structured-logger';

export async function POST(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let email = 'unknown';
  try {
    const body = await request.json().catch(() => ({}));
    email = body?.email || 'unknown';
    const adminEmail = body?.adminEmail;
    
    if (!email || typeof email !== 'string' || email === 'unknown') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const cleanEmail = email.toLowerCase().trim();


    // 1. Scan all resumes to find if there is a resume matching the email to clear attempts
    const resumes = await resumeService.getAllResumes();
    const matchResume = resumes.find(r => r.parsed?.personal?.email?.toLowerCase().trim() === cleanEmail);

    // 2. Reset the used flag in sessions (passing matchResume?.id to create a session if it doesn't exist yet)
    const session = await sessionService.resetSessionByEmail(cleanEmail, matchResume?.id);

    if (matchResume) {
      // Delete attempts
      const { error: attemptsError } = await supabase
        .from('interview_attempts')
        .delete()
        .eq('resume_id', matchResume.id);

      if (attemptsError) {
        console.error('Failed to clear interview attempts:', attemptsError);
        throw new Error(`Database error clearing attempts: ${attemptsError.message}`);
      }

      // Delete questions
      const { error: questionsError } = await supabase
        .from('interview_questions')
        .delete()
        .eq('resume_id', matchResume.id);

      if (questionsError) {
        console.error('Failed to clear interview questions:', questionsError);
        throw new Error(`Database error clearing questions: ${questionsError.message}`);
      }

      // Clear proctoring reports & videoUrl in the resumes table
      const { data: resumeRow, error: fetchErr } = await supabase
        .from('resumes')
        .select('report')
        .eq('id', matchResume.id)
        .single();

      if (!fetchErr && resumeRow) {
        let reportObj = typeof resumeRow.report === 'string' ? JSON.parse(resumeRow.report) : resumeRow.report;
        if (reportObj) {
          delete reportObj.videoUrl;
          delete reportObj.proctoring;
          delete reportObj.videoDuration;
          
          const { error: updateErr } = await supabase
            .from('resumes')
            .update({ report: JSON.stringify(reportObj) })
            .eq('id', matchResume.id);

          if (updateErr) {
            console.error('Failed to update resume report during reset:', updateErr);
          }
          
          // Update cached copy
          const cached = await resumeService.getCachedResume(matchResume.id);
          if (cached && cached.report) {
            delete cached.report.videoUrl;
            delete cached.report.proctoring;
            delete cached.report.videoDuration;
          }
        }
      }
    }

    if (!session && !matchResume) {
      return NextResponse.json({ 
        error: `No registered candidate session or CV record found for ${cleanEmail}.` 
      }, { status: 404 });
    }

    // Log the reset activity
    await resetLogService.addLog({
      candidateEmail: cleanEmail,
      resetBy: adminEmail || 'unknown@infinite.com',
      source: 'Reset Form'
    });

    await writeLog('candidate-processing', 'RESET_CANDIDATE_BY_EMAIL', 'success', `Successfully reset candidate session and attempts for email ${cleanEmail}`);
    return NextResponse.json({ success: true, message: `Session for ${cleanEmail} has been reset successfully.` });
  } catch (error: any) {
    console.error('Reset candidate session by email error:', error);
    await writeLog('candidate-processing', 'RESET_CANDIDATE_BY_EMAIL_FAILED', 'failed', `Failed to reset candidate session for email ${email}: ${error.message}`);
    return NextResponse.json({ error: error.message || 'Reset failed' }, { status: 500 });
  }
}
