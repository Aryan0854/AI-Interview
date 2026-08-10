export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resumeService } from '@/services/resume-service';
import { sessionService } from '@/services/session-service';
import { supabase } from '@/lib/db';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { checkCsrf, getClientIp } from '@/lib/security';
import { auditLogService } from '@/services/audit-log-service';
import { writeLog } from '@/lib/structured-logger';

import { cacheStore } from '@/lib/cache-store';

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const email = url.searchParams.get("email")?.toLowerCase().trim();

    const cached = cacheStore.get("resumes", 5000, email);
    if (cached) {
      return NextResponse.json({ resumes: cached });
    }

    const resumes = await resumeService.getAllResumes();
    
    // Filter resumes based on logged in email
    let filteredResumes = resumes;
    if (email && email !== "admin@infinite.com") {
      filteredResumes = resumes.filter(resume => resume.report?.rmEmail?.toLowerCase().trim() === email);
    }
    
    // Fetch all interview attempts
    const { data: attempts, error } = await supabase
      .from('interview_attempts')
      .select('*')
      .order('id', { ascending: false });
      
    if (error) {
      console.error('Failed to fetch attempts:', error);
    }
    
    // Group attempts by resume_id
    const attemptsByResume: Record<string, any[]> = {};
    if (attempts) {
      for (const attempt of attempts) {
        if (attempt.resume_id) {
          if (!attemptsByResume[attempt.resume_id]) {
            attemptsByResume[attempt.resume_id] = [];
          }
          attemptsByResume[attempt.resume_id].push(attempt);
        }
      }
    }
    
    // Fetch all sessions to check if they are concluded (used)
    const sessions = await sessionService.getAllSessions();
    const sessionsMap = new Map<string, boolean>();
    sessions.forEach((s) => {
      if (s.resumeId) {
        sessionsMap.set(s.resumeId, s.used);
      }
    });
    
    const resumesWithAttempts = filteredResumes.map(resume => ({
      ...resume,
      isConcluded: sessionsMap.get(resume.id) || false,
      interview_attempts: (attemptsByResume[resume.id] || []).map((attempt: any) => ({
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
      }))
    }));

    cacheStore.set("resumes", resumesWithAttempts, email);

    return NextResponse.json({ resumes: resumesWithAttempts });
  } catch (error) {
    console.error('Admin resumes fetch failed:', error);
    return NextResponse.json({ resumes: [] }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!checkCsrf(request)) {
    return NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 });
  }
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);

  try {
    const body = await request.json();
    const ids = body.ids;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'Candidate IDs are required' }, { status: 400 });
    }

    for (const id of ids) {
      await resumeService.deleteResumeById(id);
    }
    cacheStore.invalidate("resumes");

    await auditLogService.addLog({
      actorEmail: "admin@infinite.com",
      action: "ADMIN_BATCH_DELETE_RESUMES",
      target: ids.join(", "),
      details: `Successfully batch deleted candidate CV IDs: ${ids.join(", ")}`,
      ipAddress: ip
    });

    await writeLog('candidate-processing', 'BATCH_DELETE_CANDIDATES', 'success', `Batch deleted candidate CV IDs: ${ids.join(", ")}`);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to batch delete candidate records:', error);
    await writeLog('candidate-processing', 'BATCH_DELETE_CANDIDATES_FAILED', 'failed', `Failed to batch delete candidate records: ${error.message}`);
    return NextResponse.json({ error: error.message || 'Failed to delete candidate records' }, { status: 500 });
  }
}
