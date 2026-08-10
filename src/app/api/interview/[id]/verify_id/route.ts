export const runtime = "nodejs";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { writeFile, mkdir } from "fs/promises";
import { resumeService } from "@/services/resume-service";
import { supabaseServer } from "@/lib/db";
import { auditLogService } from "@/services/audit-log-service";
import { getClientIp } from "@/lib/security";
import {
  verifyCandidateIdentity,
  isGovernmentIdType,
  getIdTypeLabel,
} from "@/lib/identity-verification";

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

    const bucketExists = buckets?.some((b) => b.id === "verifications") ?? false;
    if (!bucketExists) {
      const { error: createErr } = await supabaseServer.storage.createBucket("verifications", {
        public: false,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
        fileSizeLimit: 8 * 1024 * 1024,
      });
      if (createErr) throw createErr;
    }

    const { error: uploadErr } = await supabaseServer.storage.from("verifications").upload(filename, buffer, {
      contentType: mimeType,
      upsert: true,
    });

    if (uploadErr) throw uploadErr;
    return true;
  } catch (err) {
    console.warn(`Supabase Storage upload failed for ${filename}, falling back to local storage:`, err);
    return false;
  }
}

function parseBase64(base64Str: string) {
  const match = base64Str.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
  }
  return { mimeType: "image/jpeg", buffer: Buffer.from(base64Str, "base64") };
}

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  try {
    const { id } = await params;

    const resume = await resumeService.getCachedResume(id, true);
    if (!resume) {
      return NextResponse.json({ error: "Resume record not found" }, { status: 404 });
    }

    const body = await request.json();
    const { idImage, selfieImage, idType } = body || {};

    if (!idImage || !selfieImage) {
      return NextResponse.json(
        { error: "ID image and Selfie snapshot are required" },
        { status: 400 }
      );
    }

    if (!isGovernmentIdType(idType)) {
      return NextResponse.json(
        {
          error:
            "Select a valid government ID type (Aadhar Card, Driving License, PAN Card, or Voter ID).",
          failureCode: "invalid_id_type",
        },
        { status: 400 }
      );
    }

    const parsedId = parseBase64(idImage);
    const parsedSelfie = parseBase64(selfieImage);

    if (parsedId.buffer.length > MAX_IMAGE_BYTES || parsedSelfie.buffer.length > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Image too large. Please recapture or upload a smaller file (max ~5MB)." },
        { status: 413 }
      );
    }

    if (parsedId.buffer.length < 2_000 || parsedSelfie.buffer.length < 2_000) {
      return NextResponse.json(
        { error: "Image appears empty or corrupted. Please recapture and try again." },
        { status: 400 }
      );
    }

    const idFilename = `${id}_id.jpg`;
    const selfieFilename = `${id}_selfie.jpg`;

    const uploadedId = await uploadToSupabase(parsedId.buffer, idFilename, parsedId.mimeType);
    if (!uploadedId) {
      await saveFileLocally(parsedId.buffer, idFilename);
    }

    const uploadedSelfie = await uploadToSupabase(
      parsedSelfie.buffer,
      selfieFilename,
      parsedSelfie.mimeType
    );
    if (!uploadedSelfie) {
      await saveFileLocally(parsedSelfie.buffer, selfieFilename);
    }

    const matchResult = await verifyCandidateIdentity({
      idImageBase64: idImage,
      selfieImageBase64: selfieImage,
      selectedIdType: idType,
    });

    const isSystemError = Boolean(matchResult.isSystemError);

    resume.report = {
      ...(resume.report || {}),
      verification: {
        status: isSystemError
          ? "system_error"
          : matchResult.matched
            ? "verified"
            : "failed",
        matched: matchResult.matched,
        confidence: matchResult.confidence,
        reason: matchResult.reason,
        selectedIdType: matchResult.selectedIdType,
        detectedIdType: matchResult.detectedIdType,
        idTypeMatched: matchResult.idTypeMatched,
        faceMatched: matchResult.faceMatched,
        failureCode: matchResult.failureCode || null,
        engine: matchResult.engine,
        verifiedAt: new Date().toISOString(),
        idImageUrl: `/api/interview/${id}/verification/id`,
        selfieImageUrl: `/api/interview/${id}/verification/selfie`,
        systemError: isSystemError,
      },
    } as any;

    const { error: dbError } = await supabaseServer.from("resumes").upsert({
      id: resume.id,
      filename: resume.filename,
      text_content: resume.originalText,
      parsed: JSON.stringify(resume.parsed),
      analysis: JSON.stringify(resume.analysis),
      enhanced: JSON.stringify(resume.enhanced),
      report: JSON.stringify(resume.report),
      error: resume.error || null,
    });

    if (dbError) {
      console.error("Failed to update resume record with verification status:", dbError);
      throw new Error(`Database Error: ${dbError.message}`);
    }

    await auditLogService.addLog({
      actorEmail: resume.parsed?.personal?.email || `candidate_${id}`,
      action: isSystemError
        ? "CANDIDATE_IDENTITY_SYSTEM_ERROR"
        : matchResult.matched
          ? "CANDIDATE_IDENTITY_VERIFIED"
          : "CANDIDATE_IDENTITY_FAILED",
      target: id,
      details: isSystemError
        ? `Biometric service unavailable. ID (${getIdTypeLabel(idType)}) and Selfie saved for manual review.`
        : `Type=${idType} detected=${matchResult.detectedIdType} typeOk=${matchResult.idTypeMatched} faceOk=${matchResult.faceMatched} confidence=${matchResult.confidence}% engine=${matchResult.engine}. ${matchResult.reason}`,
      ipAddress: ip,
    });

    return NextResponse.json({
      success: true,
      matched: matchResult.matched,
      confidence: matchResult.confidence,
      reason: matchResult.reason,
      selectedIdType: matchResult.selectedIdType,
      detectedIdType: matchResult.detectedIdType,
      idTypeMatched: matchResult.idTypeMatched,
      faceMatched: matchResult.faceMatched,
      failureCode: matchResult.failureCode || null,
      engine: matchResult.engine,
      isSystemError,
    });
  } catch (error: any) {
    console.error("ID verification API error:", error);
    return NextResponse.json(
      { error: error.message || "Verification processing failed" },
      { status: 500 }
    );
  }
}
