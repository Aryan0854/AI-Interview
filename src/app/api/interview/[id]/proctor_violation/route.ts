export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';
import { resumeService } from '@/services/resume-service';
import { interviewCSVService } from '@/services/interview-csv-service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      violationType,
      warningCount,
      timestamp,
      duration,
      confidence,
      description,
      videoTimestamp
    } = body;

    if (!violationType || typeof warningCount !== 'number') {
      return NextResponse.json({ error: 'Missing required fields: violationType, warningCount' }, { status: 400 });
    }

    // 1. Fetch current resume record
    const { data: resume, error: fetchErr } = await supabase
      .from('resumes')
      .select('report')
      .eq('id', id)
      .single();

    if (fetchErr || !resume) {
      return NextResponse.json({ error: 'Candidate record not found' }, { status: 404 });
    }

    // 2. Parse report JSON
    let reportObj: any = {};
    if (resume.report) {
      reportObj = typeof resume.report === 'string' ? JSON.parse(resume.report) : resume.report;
    }

    // 3. Initialize/Update proctoring block inside report
    if (!reportObj.proctoring) {
      reportObj.proctoring = {
        warningCount: 0,
        violations: [],
        autoSubmitted: false
      };
    }

    reportObj.proctoring.warningCount = warningCount;
    reportObj.proctoring.violations.push({
      type: violationType,
      timestamp: timestamp || new Date().toISOString(),
      warningCount,
      duration: typeof duration === 'number' ? duration : undefined,
      confidence: typeof confidence === 'number' ? confidence : undefined,
      description: description || undefined,
      videoTimestamp: typeof videoTimestamp === 'number' ? videoTimestamp : undefined
    });

    if (warningCount >= 3) {
      reportObj.proctoring.autoSubmitted = true;
    }

    // 4. Save updated report object back to DB
    const { error: updateErr } = await supabase
      .from('resumes')
      .update({ report: JSON.stringify(reportObj) })
      .eq('id', id);

    if (updateErr) {
      return NextResponse.json({ error: `Failed to update record: ${updateErr.message}` }, { status: 500 });
    }

    // 5. Update cached copy if it exists to maintain sync
    const cachedResume = await resumeService.getCachedResume(id);
    if (cachedResume) {
      cachedResume.report = reportObj;
    }

    // Auto-sync interview results to CSV after warning count updates
    await interviewCSVService.syncAllInterviewsToCSV();

    return NextResponse.json({ success: true, proctoring: reportObj.proctoring });
  } catch (err: any) {
    console.error('Proctoring violation log error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
