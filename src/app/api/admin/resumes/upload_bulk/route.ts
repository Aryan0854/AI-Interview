export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resumeService } from '@/services/resume-service';
import { sessionService } from '@/services/session-service';
import { supabase } from '@/lib/db';
import { join } from 'path';
import { readFile } from 'fs/promises';
import AdmZip from 'adm-zip';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { cacheStore } from '@/lib/cache-store';
import { checkCsrf, isRateLimited, validateFileSignature, getClientIp } from '@/lib/security';
import { auditLogService } from '@/services/audit-log-service';
import { writeLog } from '@/lib/structured-logger';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

export async function POST(request: NextRequest) {
  // 1. CSRF validation
  if (!checkCsrf(request)) {
    return NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 });
  }

  // 2. Admin Authentication
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);

  // 3. Rate limiting: 10 bulk uploads per hour per IP
  const limitCheck = isRateLimited(`upload_bulk_${ip}`, 10, 3600000);
  if (limitCheck.limited) {
    return NextResponse.json(
      { error: "Too many bulk uploads. Maximum 10 bulk upload attempts per hour allowed." },
      { status: 429 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const jdId = formData.get('jdId') as string | null;
    const rmEmail = formData.get('rmEmail') as string | null;
    const forceReplace = formData.get('forceReplace') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const isZip = file.name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';

    // Set size limit (10MB for CV, 50MB for ZIP pack)
    const maxSize = isZip ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json({ error: `File too large (max ${isZip ? '50MB' : '10MB'})` }, { status: 400 });
    }

    // 4. File Magic Byte validation on uploaded file
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    if (isZip) {
      if (!validateFileSignature(fileBuffer, file.name)) {
        return NextResponse.json({ error: 'ZIP file verification failed: invalid magic signature' }, { status: 400 });
      }
    } else {
      const allowedTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];
      if (!allowedTypes.includes(file.type) || !validateFileSignature(fileBuffer, file.name)) {
        return NextResponse.json({ error: 'File verification failed: invalid format or magic signature' }, { status: 400 });
      }
    }

    // Load current Job Description text matching jdId or fallback
    let jdText = (formData.get('jdText') as string | null) || "";
    
    if (!jdText) {
      if (jdId && jdId !== 'all') {
        try {
          const { data: dbJd, error: dbError } = await supabase
            .from('job_descriptions')
            .select('jd_text')
            .eq('id', jdId)
            .single();
          if (!dbError && dbJd?.jd_text) {
            jdText = dbJd.jd_text;
          }
        } catch (dbErr) {
          console.error("Database error fetching JD by ID:", dbErr);
        }
      }

      if (!jdText && rmEmail) {
        try {
          const { data: dbJds, error: dbError } = await supabase
            .from('job_descriptions')
            .select('jd_text')
            .eq('rm_email', rmEmail.toLowerCase().trim())
            .order('created_at', { ascending: false });
          if (!dbError && dbJds && dbJds.length > 0) {
            jdText = dbJds[0].jd_text;
          }
        } catch (dbErr) {
          console.error("Database error fetching JD by email:", dbErr);
        }
      }

      if (!jdText) {
        // Local files fallback
        try {
          const jdsJsonPath = join(getUploadsRoot(), "job_descriptions.json");
          const rawJds = await readFile(jdsJsonPath, "utf8");
          const jds = JSON.parse(rawJds);
          
          const matchJd = jds.find((j: any) => j.id === jdId);
          if (matchJd) {
            jdText = matchJd.jdText;
          } else {
            const rmJds = jds.filter((j: any) => j.rmEmail?.toLowerCase().trim() === rmEmail?.toLowerCase().trim());
            if (rmJds.length > 0) {
              jdText = rmJds[rmJds.length - 1].jdText;
            } else {
              jdText = jds[0]?.jdText || "";
            }
          }
        } catch (e: any) {
          console.warn("Failed to find JD in JSON, trying job_description.txt:", e.message);
          try {
            const jdPath = join(getUploadsRoot(), "job_description.txt");
            jdText = await readFile(jdPath, "utf8");
          } catch (err: any) {
            if (err.code !== "ENOENT") {
              console.error("Failed to read job description txt:", err);
            }
          }
        }
      }
    }

    if (isZip) {
      // Use original fileBuffer to verify zip entries
      const zip = new AdmZip(fileBuffer);
      const zipEntries = zip.getEntries();
      
      const processedResumes = [];

      for (const entry of zipEntries) {
        if (entry.isDirectory) continue;

        const entryName = entry.entryName;
        
        // Skip hidden and system files/dirs
        if (
          entryName.startsWith('__MACOSX') || 
          entryName.includes('/.') || 
          entryName.startsWith('.')
        ) {
          continue;
        }

        const ext = entryName.split('.').pop()?.toLowerCase() || '';
        const allowedExts = ['pdf', 'doc', 'docx', 'txt'];
        if (!allowedExts.includes(ext)) {
          continue; // Skip unsupported formats
        }

        const entryBuffer = entry.getData();
        if (entryBuffer.length === 0) continue;

        const baseName = entryName.split('/').pop() || entryName;

        // Verify nested file binary magic bytes signature
        if (!validateFileSignature(entryBuffer, baseName)) {
          console.warn(`[Bulk Upload Security Warning] Nested file ${baseName} failed magic signature verification. Skipping.`);
          continue;
        }

        // Map extension to mimetype
        let mimeType = 'text/plain';
        if (ext === 'pdf') {
          mimeType = 'application/pdf';
        } else if (ext === 'docx') {
          mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        } else if (ext === 'doc') {
          mimeType = 'application/msword';
        }

        const entryFile = new File([new Uint8Array(entryBuffer)], baseName, { type: mimeType });

        try {
          // Process individual resume with custom JD, JD ID and RM email
          const resume = await resumeService.processResumeSync(entryFile, jdText, jdId || undefined, rmEmail || undefined, forceReplace);
          if (resume && resume.status !== 'failed') {
            // Extract email and register session
            const email = resume.parsed?.personal?.email;
            if (email) {
              await sessionService.createCandidateSession(email, resume.id);
            }
            processedResumes.push(resume);
          }
        } catch (err) {
          console.error(`Failed to process zip entry: ${baseName}`, err);
        }
      }

      await auditLogService.addLog({
        actorEmail: rmEmail || "admin@infinite.com",
        action: "ADMIN_BULK_UPLOAD_ZIP",
        target: file.name,
        details: `Successfully uploaded bulk ZIP with ${processedResumes.length} processed nested CVs. ForceReplace: ${forceReplace}`,
        ipAddress: ip
      });

      await writeLog('candidate-processing', 'BULK_UPLOAD_ZIP', 'success', `Successfully uploaded bulk ZIP ${file.name} with ${processedResumes.length} processed nested CVs.`);

      cacheStore.invalidate("resumes");
      return NextResponse.json({
        success: true,
        isZip: true,
        resumes: processedResumes
      });
    }

    // Process single resume file with custom JD, JD ID and RM email
    const resume = await resumeService.processResumeSync(file, jdText, jdId || undefined, rmEmail || undefined, forceReplace);

    if (resume.status === 'failed') {
      await auditLogService.addLog({
        actorEmail: rmEmail || "admin@infinite.com",
        action: "ADMIN_SINGLE_UPLOAD_FAILED",
        target: file.name,
        details: `AI analysis failed: ${resume.error || 'unknown error'}`,
        ipAddress: ip
      });
      await writeLog('candidate-processing', 'SINGLE_UPLOAD_FAILED', 'failed', `AI analysis failed for CV ${file.name}: ${resume.error || 'unknown error'}`);
      return NextResponse.json({ error: resume.error || 'AI analysis failed' }, { status: 500 });
    }

    // Extract email and register session
    const email = resume.parsed?.personal?.email;
    if (email) {
      await sessionService.createCandidateSession(email, resume.id);
    } else {
      console.warn(`No email found in CV: ${file.name}. Session mapping skipped.`);
    }

    await auditLogService.addLog({
      actorEmail: rmEmail || "admin@infinite.com",
      action: "ADMIN_SINGLE_UPLOAD_SUCCESS",
      target: file.name,
      details: `Successfully uploaded and analyzed single CV. Candidate: ${email || 'unknown email'}. ForceReplace: ${forceReplace}`,
      ipAddress: ip
    });

    await writeLog('candidate-processing', 'SINGLE_UPLOAD_SUCCESS', 'success', `Successfully uploaded and analyzed single CV ${file.name} for candidate: ${email || 'unknown email'}.`);

    cacheStore.invalidate("resumes");

    return NextResponse.json({
      success: true,
      resume
    });
  } catch (error: any) {
    console.error('Bulk upload route error:', error);
    await writeLog('candidate-processing', 'UPLOAD_ROUTE_ERROR', 'failed', `Bulk upload route error: ${error.message}`);
    return NextResponse.json(
      { 
        success: false,
        error: error.message || 'Upload and parsing failed' 
      },
      { status: 500 }
    );
  }
}
