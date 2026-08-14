export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { resumeService } from '@/services/resume-service';
import { supabaseServer } from '@/lib/db';
import { geminiEngine } from '@/lib/gemini-ai';
import { auditLogService } from '@/services/audit-log-service';
import { getClientIp } from '@/lib/security';

function getUploadsRoot() {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
}

async function saveFileLocally(buffer: Buffer, filename: string): Promise<string> {
  const verificationsDir = join(getUploadsRoot(), "verifications");
  await mkdir(verificationsDir, { recursive: true });
  const filePath = join(verificationsDir, filename);
  await writeFile(filePath, buffer);
  return filePath;
}

async function uploadToSupabase(buffer: Buffer, filename: string, mimeType: string): Promise<boolean> {
  try {
    const { data: buckets, error: listErr } = await supabaseServer.storage.listBuckets();
    if (listErr) throw listErr;

    const bucketExists = buckets?.some(b => b.id === 'verifications') ?? false;
    if (!bucketExists) {
      const { error: createErr } = await supabaseServer.storage.createBucket('verifications', {
        public: true,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp']
      });
      if (createErr) throw createErr;
    }

    const { error: uploadErr } = await supabaseServer.storage
      .from('verifications')
      .upload(filename, buffer, {
        contentType: mimeType,
        upsert: true
      });

    if (uploadErr) throw uploadErr;
    return true;
  } catch (err) {
    console.warn(`Supabase Storage upload failed for ${filename}, falling back to local storage:`, err);
    return false;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  try {
    const { id } = await params;
    
    // 1. Fetch candidate resume record
    const resume = await resumeService.getCachedResume(id, true);
    if (!resume) {
      return NextResponse.json({ error: 'Resume record not found' }, { status: 404 });
    }

    const { idImage, selfieImage, idType } = await request.json();
    if (!idType || typeof idType !== 'string') {
      return NextResponse.json({ error: 'Government ID type is required' }, { status: 400 });
    }

    const validIdTypes = ['aadhar', 'driving_license', 'pan_card', 'voter_id'];
    if (!validIdTypes.includes(idType)) {
      return NextResponse.json({ error: 'Invalid Government ID type selected' }, { status: 400 });
    }

    if (!idImage || !selfieImage) {
      return NextResponse.json({ error: 'ID image and Selfie snapshot are required' }, { status: 400 });
    }

    // 2. Parse Base64 Image parts
    const parseBase64 = (base64Str: string) => {
      const match = base64Str.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
      }
      return { mimeType: 'image/png', buffer: Buffer.from(base64Str, 'base64') };
    };

    const parsedId = parseBase64(idImage);
    const parsedSelfie = parseBase64(selfieImage);

    const idFilename = `${id}_id.png`;
    const selfieFilename = `${id}_selfie.png`;

    // 3. Save files (Supabase Storage with Local Fallback)
    const uploadedId = await uploadToSupabase(parsedId.buffer, idFilename, parsedId.mimeType);
    if (!uploadedId) {
      await saveFileLocally(parsedId.buffer, idFilename);
    }

    const uploadedSelfie = await uploadToSupabase(parsedSelfie.buffer, selfieFilename, parsedSelfie.mimeType);
    if (!uploadedSelfie) {
      await saveFileLocally(parsedSelfie.buffer, selfieFilename);
    }

    // 4. Perform Biometric Comparison using local Faceproj script
    let matchResult;
    let isSystemError = false;
    try {
      matchResult = await geminiEngine.verifyFaceMatch(
        idImage,
        parsedId.mimeType,
        selfieImage,
        parsedSelfie.mimeType
      );
    } catch (aiErr: any) {
      console.error("Local face verification error:", aiErr);
      return NextResponse.json(
        { error: aiErr.message || 'Biometric verification engine failed' },
        { status: 500 }
      );
    }

    // 5. Persist verification details in resume report
    resume.report = {
      ...(resume.report || {}),
      verification: {
        status: isSystemError ? "system_error" : (matchResult.matched ? "verified" : "failed"),
        matched: matchResult.matched,
        confidence: matchResult.confidence,
        reason: matchResult.reason,
        idType,
        verifiedAt: new Date().toISOString(),
        idImageUrl: `/api/interview/${id}/verification/id`,
        selfieImageUrl: `/api/interview/${id}/verification/selfie`,
        systemError: isSystemError
      }
    } as any;

    const { error: dbError } = await supabaseServer.from('resumes').upsert({
      id: resume.id,
      filename: resume.filename,
      text_content: resume.originalText,
      parsed: JSON.stringify(resume.parsed),
      analysis: JSON.stringify(resume.analysis),
      enhanced: JSON.stringify(resume.enhanced),
      report: JSON.stringify(resume.report),
      error: resume.error || null
    });

    if (dbError) {
      console.error("Failed to update resume record with verification status:", dbError);
      throw new Error(`Database Error: ${dbError.message}`);
    }

    // 6. Log event in Audit Log
    await auditLogService.addLog({
      actorEmail: resume.parsed?.personal?.email || `candidate_${id}`,
      action: isSystemError 
        ? "CANDIDATE_IDENTITY_SYSTEM_ERROR"
        : (matchResult.matched ? "CANDIDATE_IDENTITY_VERIFIED" : "CANDIDATE_IDENTITY_FAILED"),
      target: id,
      details: isSystemError 
        ? `Biometric service unavailable. ID and Selfie saved for manual review. ID Type: ${idType}`
        : `ID Type: ${idType}. Confidence: ${matchResult.confidence}%. Rationale: ${matchResult.reason}`,
      ipAddress: ip
    });

    return NextResponse.json({
      success: true,
      matched: matchResult.matched,
      confidence: matchResult.confidence,
      reason: matchResult.reason,
      isSystemError: isSystemError
    });
  } catch (error: any) {
    console.error('ID verification API error:', error);
    return NextResponse.json({ error: error.message || 'Verification processing failed' }, { status: 500 });
  }
}
