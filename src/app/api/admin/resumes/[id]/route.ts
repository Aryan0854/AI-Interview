export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resumeService } from '@/services/resume-service';
import { supabase } from '@/lib/db';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { checkCsrf, getClientIp } from '@/lib/security';
import { auditLogService } from '@/services/audit-log-service';
import { writeLog } from '@/lib/structured-logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const resume = await resumeService.getCachedResume(id, true);

  if (!resume) {
    return NextResponse.json({ error: 'Resume not found' }, { status: 404 });
  }

  const { data: attempts, error } = await supabase
    .from('interview_attempts')
    .select('*')
    .eq('resume_id', id)
    .order('question_index', { ascending: true });

  if (error) {
    console.error('Failed to fetch interview attempts for resume:', error);
  }

  const formattedAttempts = (attempts || []).map((attempt: any) => ({
    ...attempt,
    candidate_id: attempt.resume_id,
    question_number: attempt.question_index === -1
      ? 'Intro'
      : attempt.question_index === -2
        ? 'Q to HR'
        : typeof attempt.question_index === 'number'
          ? attempt.question_index + 1
          : null,
    question: attempt.question_text,
    ai_score: attempt.mock_score,
    ai_feedback: attempt.mock_feedback,
    timestamp: attempt.timestamp || attempt.created_at || attempt.createdAt || null,
  }));

  return NextResponse.json({ resume: { ...resume, interview_attempts: formattedAttempts } });
}

export async function DELETE(
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
    await resumeService.deleteResumeById(id);

    await auditLogService.addLog({
      actorEmail: "admin@infinite.com",
      action: "ADMIN_DELETE_RESUME",
      target: id,
      details: `Successfully deleted candidate resume ID: ${id}`,
      ipAddress: ip
    });

    await writeLog('candidate-processing', 'DELETE_CANDIDATE', 'success', `Successfully deleted candidate CV ID: ${id}`);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete resume:', error);
    await writeLog('candidate-processing', 'DELETE_CANDIDATE_FAILED', 'failed', `Failed to delete candidate CV ID: ${id}: ${error?.message || 'unknown error'}`);
    return NextResponse.json(
      { error: error?.message || 'Failed to delete resume' },
      { status: 500 }
    );
  }
}
