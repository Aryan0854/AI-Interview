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
import { allowLocalDataFallback } from '@/lib/db-mode';
import {
  extractBrId,
  isPermanentlyRemovedBrId,
  isRequirementDeleted,
  loadDeletedRequirements,
  markRequirementsDeleted,
} from '@/lib/deleted-requirements';
import { eraseDeletedRequirementsFromMaster } from '@/services/automation-service';
import { adminCanViewOrgScreeningData } from '@/lib/admin-accounts-server';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

const getJdsJsonPath = () => {
  return join(getUploadsRoot(), "job_descriptions.json");
};

const getJdPath = () => {
  return join(getUploadsRoot(), "job_description.txt");
};

function parseRequirementCreatedAt(raw: string, fallback: string): string {
  const value = String(raw || "").trim();
  if (!value) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0).toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString();
}

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
      const deleted = await loadDeletedRequirements({ fresh: true });
      jds = dbJds
        .filter((row: any) => !isRequirementDeleted(deleted, {
          id: row.id,
          fileName: row.file_name,
          jdText: row.jd_text,
        }))
        .map((row: any) => ({
        id: row.id,
        jdText: row.jd_text,
        rmEmail: row.rm_email,
        fileName: row.file_name || "Pasted Job Description",
        createdAt: row.created_at
      }));
    } else if (dbError) {
      console.warn("Supabase JD fetch failed, falling back to file storage:", dbError.message);
    }
    
    // 2. Local JSON only when explicitly allowed (offline) — Supabase is source of truth
    if (jds.length === 0 && allowLocalDataFallback()) {
      await mkdir(getUploadsRoot(), { recursive: true });
      const localJds = await ensureJdsJson();
      const deleted = await loadDeletedRequirements({ fresh: true });
      jds = localJds.filter((localJd: any) => !isRequirementDeleted(deleted, {
        id: localJd.id,
        fileName: localJd.fileName,
        jdText: localJd.jdText,
      }));
      
      // Auto-migrate local file JDs to Supabase in the background if database is working
      if (!dbError) {
        for (const localJd of jds) {
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
    } else if (jds.length === 0 && dbError) {
      console.warn("No job descriptions from Supabase and local fallback disabled.");
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

    // Shared org JDs (admin@infinite.com) are visible to every admin login.
    if (!email || (await adminCanViewOrgScreeningData(email))) {
      return NextResponse.json({ jds });
    }
    const filtered = jds.filter((j: any) => {
      const owner = (j.rmEmail || "").toLowerCase().trim();
      return owner === email || owner === "admin@infinite.com" || !owner;
    });
    return NextResponse.json({ jds: filtered });
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
    let requestedCreatedAt = "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      rmEmail = ((formData.get("rmEmail") as string | null) || "admin@infinite.com").toLowerCase().trim();

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      const ext = file.name.split(".").pop()?.toLowerCase();
      const allowedExts = ["pdf", "doc", "docx", "txt", "html", "htm"];
      if (!allowedExts.includes(ext || "")) {
        return NextResponse.json({ error: "Invalid file type. Only PDF, Word, Text, and HTML files are allowed." }, { status: 400 });
      }

      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const extractedText = await resumeService.extractTextFromBuffer(buffer, file.name);
      fileName = file.name;
      jdText = extractedText;
    } else {
      const body = await request.json();
      jdText = body.jd;
      rmEmail = body.rmEmail || "admin@infinite.com";
      jdId = body.jdId;
      if (typeof body.createdAt === "string") {
        requestedCreatedAt = body.createdAt.trim();
      }
      if (jdId) {
        isUpdate = true;
        // Try getting existing file name from DB
        try {
          const { data: existing } = await supabase
            .from('job_descriptions')
            .select('file_name, created_at, rm_email')
            .eq('id', jdId)
            .maybeSingle();
          if (existing?.file_name) {
            fileName = existing.file_name;
          }
          if (!requestedCreatedAt && existing?.created_at) {
            requestedCreatedAt = existing.created_at;
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
            if (!requestedCreatedAt && existingLocal?.createdAt) {
              requestedCreatedAt = existingLocal.createdAt;
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

    if (isPermanentlyRemovedBrId(fileName) || isPermanentlyRemovedBrId(jdId)) {
      return NextResponse.json(
        { error: "This requirement was permanently removed and cannot be restored." },
        { status: 409 }
      );
    }

    const id = jdId || crypto.randomUUID();
    const createdAt = parseRequirementCreatedAt(requestedCreatedAt, new Date().toISOString());

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
            ? { ...j, jdText: jdText.trim(), rmEmail: rmEmail.toLowerCase().trim(), fileName, createdAt } 
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
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const rawIds: unknown[] = Array.isArray(body.ids) ? body.ids : id ? [id] : [];
  const ids: string[] = Array.from(
    new Set(
      rawIds
        .map((value: unknown) => String(value ?? "").trim())
        .filter((value) => value.length > 0)
    )
  );

  try {
    if (ids.length === 0) {
      return NextResponse.json({ error: "JD ID is required" }, { status: 400 });
    }

    const { data: existingRows } = await supabase
      .from("job_descriptions")
      .select("id, file_name, jd_text");
    const selected = new Set(ids.map((value) => value.toLowerCase()));
    const matchingRows = (existingRows || []).filter((row: any) => {
      if (selected.has(String(row.id || "").toLowerCase())) return true;
      const brId = extractBrId(row.file_name);
      return Boolean(
        brId &&
          (existingRows || []).some(
            (picked: any) =>
              selected.has(String(picked.id || "").toLowerCase()) &&
              extractBrId(picked.file_name) === brId
          )
      );
    });
    await markRequirementsDeleted(
      matchingRows.map((row: any) => ({
        id: row.id,
        brId: extractBrId(row.file_name),
        fileName: row.file_name,
        jdText: row.jd_text,
      }))
    );

    const extraBrIds = matchingRows
      .map((row: any) => extractBrId(row.file_name))
      .filter(Boolean);
    await eraseDeletedRequirementsFromMaster(extraBrIds);

    const idsToDelete = Array.from(
      new Set([
        ...ids,
        ...matchingRows.map((row: any) => String(row.id || "")).filter(Boolean),
      ])
    );
    const { error: dbError } = await supabase
      .from('job_descriptions')
      .delete()
      .in('id', idsToDelete);

    if (dbError) {
      console.warn("Failed to delete JD from Supabase:", dbError.message);
    }

    try {
      let jds = await ensureJdsJson();
      const deleted = await loadDeletedRequirements();
      jds = jds.filter((j: any) =>
        !idsToDelete.includes(j.id) &&
        !isRequirementDeleted(deleted, { id: j.id, fileName: j.fileName, jdText: j.jdText })
      );
      await writeFile(getJdsJsonPath(), JSON.stringify(jds, null, 2), "utf8");
    } catch (localErr) {}

    await auditLogService.addLog({
      actorEmail: "admin@infinite.com",
      action: ids.length > 1 ? "ADMIN_BATCH_DELETE_JD" : "ADMIN_DELETE_JD",
      target: ids.join(", "),
      details: `Successfully deleted JD ID${ids.length > 1 ? "s" : ""}: ${ids.join(", ")}`,
      ipAddress: ip
    });

    await writeLog(
      'requirements',
      ids.length > 1 ? 'BATCH_DELETE_JD' : 'DELETE_JD',
      'success',
      `Successfully deleted JD ID${ids.length > 1 ? "s" : ""}: ${ids.join(", ")}`
    );

    return NextResponse.json({ success: true, deletedCount: ids.length });
  } catch (error: any) {
    console.error("Failed to delete JD:", error);
    await writeLog('requirements', 'DELETE_JD_FAILED', 'failed', `Failed to delete Job Description ID ${ids.join(", ")}: ${error.message}`);
    return NextResponse.json({ error: error.message || "Failed to delete Job Description" }, { status: 500 });
  }
}
