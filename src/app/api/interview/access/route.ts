export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { sessionService } from '@/services/session-service';
import { resumeService } from '@/services/resume-service';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ success: false, message: 'Email address is required' }, { status: 400 });
    }

    const cleanEmail = email.toLowerCase().trim();
    const session = await sessionService.getSessionByEmail(cleanEmail);

    if (!session) {
      return NextResponse.json({
        success: false,
        message: 'This email is not registered for an interview session. Please contact HR or ensure it matches the email on your CV.'
      }, { status: 404 });
    }

    if (session.used) {
      return NextResponse.json({
        success: false,
        message: 'You have already completed this interview. Duplicate participation or re-entry is not permitted.'
      }, { status: 403 });
    }

    // Verify if the associated resume exists
    if (session.resumeId) {
      const resume = await resumeService.getCachedResume(session.resumeId);
      if (!resume) {
        return NextResponse.json({
          success: false,
          message: 'Associated resume record was not found. Please contact HR.'
        }, { status: 404 });
      }
    }

    return NextResponse.json({
      success: true,
      resumeId: session.resumeId
    });
  } catch (error: any) {
    console.error('Access check error:', error);
    return NextResponse.json({ success: false, message: error.message || 'Verification failed' }, { status: 500 });
  }
}
