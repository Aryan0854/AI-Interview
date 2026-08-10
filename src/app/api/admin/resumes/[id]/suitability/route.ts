export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resumeService } from '@/services/resume-service';
import { supabase } from '@/lib/db';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { writeLog } from '@/lib/structured-logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const { suitability, activeJdId } = await request.json();

    if (suitability !== 'suitable' && suitability !== 'unsuitable') {
      return NextResponse.json({ error: 'Invalid suitability value. Must be suitable or unsuitable.' }, { status: 400 });
    }

    const resume = await resumeService.getCachedResume(id);
    if (!resume) {
      return NextResponse.json({ error: 'Resume record not found' }, { status: 404 });
    }

    // Update the suitability and associated JD ID in the report object
    resume.report = {
      ...resume.report,
      suitability,
      ...(activeJdId ? { jdId: activeJdId } : {})
    };

    // Save to Database
    const { error } = await supabase.from('resumes').upsert({
      id: resume.id,
      filename: resume.filename,
      text_content: resume.originalText,
      parsed: JSON.stringify(resume.parsed),
      analysis: JSON.stringify(resume.analysis),
      enhanced: JSON.stringify(resume.enhanced),
      report: JSON.stringify(resume.report),
      error: resume.error || null
    });

    if (error) {
      console.error('Failed to save updated suitability:', error);
      throw new Error(`Database Error: ${error.message}`);
    }

    await writeLog('candidate-processing', 'OVERRIDE_SUITABILITY', 'success', `Overrode candidate ID ${id} suitability to ${suitability} for JD ${activeJdId || 'default'}`);
    return NextResponse.json({ success: true, suitability });
  } catch (error: any) {
    console.error('Override suitability error:', error);
    await writeLog('candidate-processing', 'OVERRIDE_SUITABILITY_FAILED', 'failed', `Failed to override candidate ID ${id} suitability: ${error.message}`);
    return NextResponse.json({ error: error.message || 'Override failed' }, { status: 500 });
  }
}
