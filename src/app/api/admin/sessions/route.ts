export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { sessionService } from '@/services/session-service';
import { authenticateAdminRequest } from '@/lib/employee-auth';

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sessions = await sessionService.getAllSessions();
    return NextResponse.json({ sessions });
  } catch (error: any) {
    console.error('Failed to fetch sessions:', error);
    return NextResponse.json({ sessions: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const session = await sessionService.createSession();
    return NextResponse.json({ session });
  } catch (error: any) {
    console.error('Failed to create session:', error);
    return NextResponse.json({ error: error.message || 'Unable to create session' }, { status: 500 });
  }
}
