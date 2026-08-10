export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { sessionService } from '@/services/session-service';
import { resumeService } from '@/services/resume-service';
import { interviewCSVService } from '@/services/interview-csv-service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const resume = await resumeService.getCachedResume(id, true);
    if (!resume) {
      return NextResponse.json({ error: 'Resume record not found' }, { status: 404 });
    }

    const email = resume.parsed?.personal?.email;
    if (email) {
      await sessionService.markEmailSessionUsed(email);
      // Auto-sync interview results to CSV after status is marked Completed
      await interviewCSVService.syncAllInterviewsToCSV();
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Conclude interview error:', error);
    return NextResponse.json({ error: error.message || 'Conclude failed' }, { status: 500 });
  }
}
