export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { resumeService } from '@/services/resume-service';
import { supabase } from '@/lib/db';
import crypto from 'crypto';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { checkCsrf, getClientIp } from '@/lib/security';
import { auditLogService } from '@/services/audit-log-service';
import { writeLog } from '@/lib/structured-logger';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

const getJdsJsonPath = () => {
  return join(getUploadsRoot(), "job_descriptions.json");
};

const getJdPath = () => {
  return join(getUploadsRoot(), "job_description.txt");
};

// Migrate old job_description.txt to JSON if it exists and JSON doesn't
async function ensureJdsJson() {
  const jsonPath = getJdsJsonPath();
  const txtPath = getJdPath();
  
  try {
    const raw = await readFile(jsonPath, "utf8");
    return JSON.parse(raw);
  } catch (e: any) {
    if (e.code === "ENOENT") {
      let txtContent = "";
      try {
        txtContent = await readFile(txtPath, "utf8");
      } catch (txtErr: any) {
        if (txtErr.code !== "ENOENT") throw txtErr;
      }
      
      const initialJds = [];
      if (txtContent.trim()) {
        initialJds.push({
          id: "default-jd-id",
          jdText: txtContent.trim(),
          rmEmail: "admin@infinite.com",
          fileName: "job_description.txt",
          createdAt: new Date().toISOString()
        });
        await writeFile(jsonPath, JSON.stringify(initialJds, null, 2), "utf8");
      }
      return initialJds;
    }
    throw e;
  }
}

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const email = url.searchParams.get("email")?.toLowerCase().trim();
    
    let jds: any[] = [];
    
    // 1. Try to fetch JDs from Supabase Database
    const { data: dbJds, error: dbError } = await supabase
      .from('job_descriptions')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (!dbError && dbJds) {
      jds = dbJds.map((row: any) => ({
        id: row.id,
        jdText: row.jd_text,
        rmEmail: row.rm_email,
        fileName: row.file_name || "Pasted Job Description",
        createdAt: row.created_at
      }));
    } else if (dbError) {
      console.warn("Supabase JD fetch failed, falling back to file storage:", dbError.message);
    }
    
    // 2. If database is empty or fails, check and load/migrate local backup
    if (jds.length === 0) {
      await mkdir(getUploadsRoot(), { recursive: true });
      const localJds = await ensureJdsJson();
      jds = localJds;
      
      // Auto-migrate local file JDs to Supabase in the background if database is working
      if (!dbError) {
        for (const localJd of localJds) {
          try {
            await supabase.from('job_descriptions').insert({
              id: localJd.id,
              jd_text: localJd.jdText,
              rm_email: localJd.rmEmail,
              file_name: localJd.fileName,
              created_at: localJd.createdAt
            });
          } catch (migrateErr) {
            console.error("Failed to migrate local JD to Supabase:", migrateErr);
          }
        }
      }
    }

    // Group and automatically de-duplicate duplicate JDs (keeping the latest one)
    const groups: { [key: string]: any[] } = {};
    for (const jd of jds) {
      let brId = "";
      if (jd.fileName && jd.fileName.includes(" | ")) {
        brId = jd.fileName.split(" | ")[0];
      }
      
      const contentKey = brId 
        ? `br_${brId}`
        : `file_${jd.fileName || ""}_text_${(jd.jdText || "").trim().substring(0, 500)}`;
        
      if (!groups[contentKey]) {
        groups[contentKey] = [];
      }
      groups[contentKey].push(jd);
    }

    const uniqueJds: any[] = [];
    for (const key in groups) {
      const groupList = groups[key];
      // Since jds is sorted by created_at desc, groupList[0] is the latest one
      const masterJd = groupList[0];
      masterJd.duplicateIds = groupList.map((j: any) => j.id);
      uniqueJds.push(masterJd);
    }

    // Sort uniqueJds by createdAt descending to preserve newest-first ordering
    uniqueJds.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    jds = uniqueJds;
    
    if (!email || email === "admin@infinite.com") {
      return NextResponse.json({ jds });
    } else {
      const filtered = jds.filter((j: any) => j.rmEmail?.toLowerCase().trim() === email);
      return NextResponse.json({ jds: filtered });
    }
  } catch (error: any) {
    console.error("Failed to read JDs:", error);
    return NextResponse.json({ error: "Failed to read Job Descriptions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!checkCsrf(request)) {
    return NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 });
  }
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);

  try {
    const contentType = request.headers.get("content-type") || "";
    await mkdir(getUploadsRoot(), { recursive: true });
    
    let jdText = "";
    let rmEmail = "admin@infinite.com";
    let fileName = "Pasted Job Description";
    let jdId = "";
    let isUpdate = false;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      rmEmail = ((formData.get("rmEmail") as string | null) || "admin@infinite.com").toLowerCase().trim();

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      const ext = file.name.split(".").pop()?.toLowerCase();
      const allowedExts = ["pdf", "doc", "docx", "txt"];
      if (!allowedExts.includes(ext || "")) {
        return NextResponse.json({ error: "Invalid file type. Only PDF, Word, and Text files are allowed." }, { status: 400 });
      }

      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const extractedText = await resumeService.extractTextFromBuffer(buffer);
      fileName = file.name;
      jdText = extractedText;
    } else {
      const body = await request.json();
      jdText = body.jd;
      rmEmail = body.rmEmail || "admin@infinite.com";
      jdId = body.jdId;
      if (jdId) {
        isUpdate = true;
        // Try getting existing file name from DB
        try {
          const { data: existing } = await supabase
            .from('job_descriptions')
            .select('file_name')
            .eq('id', jdId)
            .maybeSingle();
          if (existing?.file_name) {
            fileName = existing.file_name;
          }
        } catch (dbErr) {}
        
        // If not found in DB or default, try looking in local storage
        if (fileName === "Pasted Job Description") {
          try {
            const localJds = await ensureJdsJson();
            const existingLocal = localJds.find((j: any) => j.id === jdId);
            if (existingLocal?.fileName) {
              fileName = existingLocal.fileName;
            }
          } catch (localErr) {}
        }
      }
      if (body.fileName) {
        fileName = body.fileName;
      }
    }

    if (!jdText || !jdText.trim()) {
      return NextResponse.json({ error: "Job description text cannot be empty" }, { status: 400 });
    }

    const id = jdId || crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // 1. Persist to Supabase Database
    const { error: dbError } = await supabase.from('job_descriptions').upsert({
      id,
      jd_text: jdText.trim(),
      rm_email: rmEmail.toLowerCase().trim(),
      file_name: fileName,
      created_at: createdAt
    });

    if (dbError) {
      console.warn("Failed to persist JD to Supabase database:", dbError.message);
    }

    // 2. Fallback: Maintain local backup files for compatibility/fallback
    try {
      let localJds = await ensureJdsJson();
      if (isUpdate) {
        localJds = localJds.map((j: any) => 
          j.id === id 
            ? { ...j, jdText: jdText.trim(), rmEmail: rmEmail.toLowerCase().trim(), fileName } 
            : j
        );
      } else {
        localJds.push({ 
          id, 
          jdText: jdText.trim(), 
          rmEmail: rmEmail.toLowerCase().trim(), 
          fileName, 
          createdAt 
        });
      }
      await writeFile(getJdsJsonPath(), JSON.stringify(localJds, null, 2), "utf8");
      await writeFile(getJdPath(), jdText.trim(), "utf8");
    } catch (localErr) {
      console.error("Failed to write local JD backup files:", localErr);
    }

    await auditLogService.addLog({
      actorEmail: rmEmail || "admin@infinite.com",
      action: isUpdate ? "ADMIN_UPDATE_JD" : "ADMIN_CREATE_JD",
      target: fileName || id,
      details: `JD ID: ${id}. Associated RM: ${rmEmail}`,
      ipAddress: ip
    });

    await writeLog('requirements', isUpdate ? 'UPDATE_JD' : 'CREATE_JD', 'success', `Successfully ${isUpdate ? 'updated' : 'created'} JD ID: ${id} (${fileName}). Associated RM: ${rmEmail}`);

    return NextResponse.json({ 
      success: true, 
      jd: {
        id,
        jdText: jdText.trim(),
        rmEmail: rmEmail.toLowerCase().trim(),
        fileName,
        createdAt
      } 
    });
  } catch (error: any) {
    console.error("Failed to save JD:", error);
    await writeLog('requirements', 'SAVE_JD_FAILED', 'failed', `Failed to save Job Description: ${error.message}`);
    return NextResponse.json({ error: error.message || "Failed to save Job Description" }, { status: 500 });
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

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  try {
    if (!id) {
      return NextResponse.json({ error: "JD ID is required" }, { status: 400 });
    }

    // 1. Delete from Supabase Database
    const { error: dbError } = await supabase
      .from('job_descriptions')
      .delete()
      .eq('id', id);

    if (dbError) {
      console.warn("Failed to delete JD from Supabase:", dbError.message);
    }

    // 2. Fallback: Update local backup files
    try {
      let jds = await ensureJdsJson();
      jds = jds.filter((j: any) => j.id !== id);
      await writeFile(getJdsJsonPath(), JSON.stringify(jds, null, 2), "utf8");
    } catch (localErr) {}

    await auditLogService.addLog({
      actorEmail: "admin@infinite.com",
      action: "ADMIN_DELETE_JD",
      target: id,
      details: `Successfully deleted JD ID: ${id}`,
      ipAddress: ip
    });

    await writeLog('requirements', 'DELETE_JD', 'success', `Successfully deleted JD ID: ${id}`);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to delete JD:", error);
    await writeLog('requirements', 'DELETE_JD_FAILED', 'failed', `Failed to delete Job Description ID ${id}: ${error.message}`);
    return NextResponse.json({ error: error.message || "Failed to delete Job Description" }, { status: 500 });
  }
}
