import { NextRequest, NextResponse } from 'next/server';
import { resumeService } from '@/services/resume-service';
import { sessionService } from '@/services/session-service';
import { checkCsrf, isRateLimited, validateFileSignature, getClientIp } from '@/lib/security';
import { auditLogService } from '@/services/audit-log-service';

export async function POST(request: NextRequest) {
  // 1. CSRF validation
  if (!checkCsrf(request)) {
    return NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 });
  }

  const ip = getClientIp(request);

  // 2. Rate limiting: 10 uploads per hour per IP
  const limitCheck = isRateLimited(`upload_cv_${ip}`, 10, 3600000);
  if (limitCheck.limited) {
    return NextResponse.json(
      { error: "Too many uploads. Maximum 10 resume uploads per hour allowed." },
      { status: 429 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const sessionCode = formData.get('session')?.toString().trim();

    if (!sessionCode) {
      return NextResponse.json({ error: 'Session code is required' }, { status: 400 });
    }

    const session = await sessionService.getSession(sessionCode);
    if (!session) {
      return NextResponse.json({ error: 'Invalid session code' }, { status: 400 });
    }

    if (session.used) {
      return NextResponse.json({ error: 'This session code has already been used' }, { status: 400 });
    }

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
    }

    // 3. Deep Magic Byte Signature Validation
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!validateFileSignature(buffer, file.name)) {
      return NextResponse.json(
        { error: 'File verification failed: magic signature mismatch (tampered file content)' },
        { status: 400 }
      );
    }

    const resume = await resumeService.queueResumeProcessing(file);
    await sessionService.markSessionUsed(sessionCode, resume.id);

    // 4. Audit logging
    await auditLogService.addLog({
      actorEmail: session.email || `session_${sessionCode}`,
      action: "CANDIDATE_RESUME_UPLOAD",
      target: file.name,
      details: `Successful upload and queued parsing. Session code: ${sessionCode}`,
      ipAddress: ip
    });

    return NextResponse.json({
      success: true,
      resumeId: resume.id,
      status: resume.status,
      processing: resume.status === "processing",
      filename: file.name,
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error.message || 'Upload failed' 
      },
      { status: 500 }
    );
  }
}