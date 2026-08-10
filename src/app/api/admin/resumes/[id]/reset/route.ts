export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resumeService } from '@/services/resume-service';
import { sessionService } from '@/services/session-service';
import { supabase } from '@/lib/db';
import { resetLogService } from '@/services/reset-log-service';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { checkCsrf, getClientIp } from '@/lib/security';
import { auditLogService } from '@/services/audit-log-service';
import { writeLog } from '@/lib/structured-logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkCsrf(request)) {
    return NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 });
  }
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  const { id } = await params;

  try {
    let adminEmail = 'unknown@infinite.com';
    try {
      const body = await request.json();
      if (body && body.adminEmail) {
        adminEmail = body.adminEmail;
      }
    } catch (e) {
      // Body might be empty or invalid JSON
    }

    const resume = await resumeService.getCachedResume(id);
    if (!resume) {
      return NextResponse.json({ error: 'Resume record not found' }, { status: 404 });
    }

    const email = resume.parsed?.personal?.email;
    if (!email) {
      return NextResponse.json({ error: 'Candidate email address not found in resume parsed structure' }, { status: 400 });
    }

    // 1. Reset used flag in session registry
    await sessionService.resetSessionByEmail(email, id);

    // 2. Delete all interview attempts for this candidate from the database
    const { error: attemptsError } = await supabase
      .from('interview_attempts')
      .delete()
      .eq('resume_id', id);

    if (attemptsError) {
      console.error('Failed to clear interview attempts:', attemptsError);
      throw new Error(`Database error clearing attempts: ${attemptsError.message}`);
    }

    // 2b. Delete all interview questions for this candidate from the database
    const { error: questionsError } = await supabase
      .from('interview_questions')
      .delete()
      .eq('resume_id', id);

    if (questionsError) {
      console.error('Failed to clear interview questions:', questionsError);
      throw new Error(`Database error clearing questions: ${questionsError.message}`);
    }

    // 2c. Clear proctoring reports & videoUrl in the resumes table
    const { data: resumeRow, error: fetchErr } = await supabase
      .from('resumes')
      .select('report')
      .eq('id', id)
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
          .eq('id', id);

        if (updateErr) {
          console.error('Failed to update resume report during reset:', updateErr);
        }
        
        // Update cached copy
        const cached = await resumeService.getCachedResume(id);
        if (cached && cached.report) {
          delete cached.report.videoUrl;
          delete cached.report.proctoring;
          delete cached.report.videoDuration;
        }
      }
    }

    // Log the reset activity to audit logging service
    await auditLogService.addLog({
      actorEmail: adminEmail,
      action: "ADMIN_RESET_RESUME",
      target: email,
      details: `Cleared proctoring, questions, and attempts for candidate ${email}`,
      ipAddress: ip
    });

    await writeLog('candidate-processing', 'RESET_CANDIDATE', 'success', `Cleared proctoring, questions, and attempts for candidate ${email}`);

    // Log the reset activity to compatibility logger
    await resetLogService.addLog({
      candidateEmail: email,
      resetBy: adminEmail,
      source: 'Candidate Card',
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Reset candidate session error:', error);
    await writeLog('candidate-processing', 'RESET_CANDIDATE_FAILED', 'failed', `Failed to reset candidate session for ID ${id}: ${error.message}`);
    return NextResponse.json({ error: error.message || 'Reset failed' }, { status: 500 });
  }
}
