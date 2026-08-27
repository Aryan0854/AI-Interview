import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile } from 'fs/promises';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { checkCsrf } from '@/lib/security';
import { writeDocFile, type DocCategory } from '@/lib/docs-storage';
import { 
  refreshRequirements, 
  refreshCandidates, 
  refreshEmployees, 
  refreshInterviews,
  sanitizeCorpPoolFileName,
  isCorpPoolRosterFileName,
  excelLooksLikeCorpPoolRoster,
} from '@/services/automation-service';
import {
  excelLooksLikePortalMapping,
  invalidatePortalMappingCaches,
} from '@/services/resource-mapping-service';
import {
  isPortalCredentialsFileName,
  isPortalMappingFileName,
  PORTAL_MAPPING_STORED_NAME,
} from '@/lib/portal-mapping-file';

export const runtime = 'nodejs';
export const maxDuration = 300;

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

const CATEGORY_MAP: Record<string, { docCategory?: DocCategory; refresh: string }> = {
  resume: { docCategory: "Resumes", refresh: "candidates" },
  jd: { docCategory: "JD", refresh: "requirements" },
  br: { docCategory: "BR", refresh: "requirements" },
  employee: { docCategory: "Corp Pool", refresh: "employees" },
  "portal-mapping": { docCategory: "Portal Mapping", refresh: "portal-mapping" },
  interview: { refresh: "interviews" },
};

function inferUploadCategory(filename: string, selected: string): string {
  const name = String(filename || "").toLowerCase();
  const collapsed = name.replace(/\s+/g, "_");
  if (selected === "interview") return "interview";
  if (/\d+\s*br\.(docx|doc|pdf|txt|html|htm)$/i.test(name)) return "jd";
  if (/\.(xlsx|xls|csv)$/i.test(name) && (/\d+\s*br/i.test(name) || /br_rawdata/i.test(collapsed))) {
    return "br";
  }
  if (selected === "br") return "br";
  if (selected === "jd") return "jd";
  if (isPortalMappingFileName(filename)) return "portal-mapping";
  if (selected === "portal-mapping") return "portal-mapping";
  if (isCorpPoolRosterFileName(filename)) return "employee";
  if (name.endsWith(".csv")) return "employee";
  return selected || "resume";
}

export async function POST(request: NextRequest) {
  if (!checkCsrf(request)) {
    return NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 });
  }
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const selectedCategory = formData.get('category') as string || '';
    const activeJdId = formData.get('activeJdId') as string || undefined;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (isPortalCredentialsFileName(file.name)) {
      return NextResponse.json(
        { error: "Credential workbooks are not uploaded. Use Resource_Question_Mapping.xlsx only." },
        { status: 400 }
      );
    }

    let category = inferUploadCategory(file.name, selectedCategory);
    if (
      category !== "portal-mapping" &&
      /\.(xlsx|xls)$/i.test(file.name) &&
      (await excelLooksLikePortalMapping(buffer))
    ) {
      category = "portal-mapping";
    }
    if (
      category !== "employee" &&
      category !== "interview" &&
      category !== "br" &&
      category !== "jd" &&
      category !== "portal-mapping" &&
      /\.(xlsx|xls)$/i.test(file.name) &&
      (await excelLooksLikeCorpPoolRoster(buffer))
    ) {
      category = "employee";
    }
    const mapping = CATEGORY_MAP[category];
    if (!mapping) {
      return NextResponse.json({ error: "Invalid upload category" }, { status: 400 });
    }
    const filename = mapping.docCategory === "Corp Pool"
      ? sanitizeCorpPoolFileName(file.name)
      : mapping.docCategory === "Portal Mapping"
        ? PORTAL_MAPPING_STORED_NAME
        : file.name;
    const actorEmail = String(formData.get("actorEmail") || formData.get("adminEmail") || "").trim().toLowerCase();

    if (category === 'interview') {
      const csvPath = join(getUploadsRoot(), "candidate_interview_data.csv");
      await writeFile(csvPath, buffer);
    } else if (mapping.docCategory) {
      await writeDocFile(mapping.docCategory, filename, buffer);
    }

    let refreshResult: Record<string, unknown> = {};
    if (mapping.refresh === 'requirements') {
      refreshResult = await refreshRequirements(
        category === "br"
          ? { incomingBrFiles: [filename], actorEmail }
          : category === "jd"
            ? { incomingJdFiles: [filename], actorEmail }
            : { actorEmail }
      );
      if (category === "jd" && Number(refreshResult.convertedJDs || 0) === 0) {
        throw new Error(
          "The JD was stored, but it could not be added to Requirements. Check the file has readable text and a BR ID in the filename (for example 50656BR.docx or 50656BR.html)."
        );
      }
      if (category === "br" && Number(refreshResult.incomingBrRows || 0) === 0) {
        throw new Error(
          "The BR file was stored, but no requirement rows were found. Use an Excel with an Auto req ID / BR ID column."
        );
      }
    } else if (mapping.refresh === 'candidates') {
      refreshResult = await refreshCandidates(activeJdId);
    } else if (mapping.refresh === 'employees') {
      refreshResult = await refreshEmployees(activeJdId, {
        incomingCorpPoolFiles: [filename],
        incomingFileBuffers: [{ filename, buffer }],
      });
    } else if (mapping.refresh === 'portal-mapping') {
      invalidatePortalMappingCaches();
      refreshResult = { stored: filename, liveSource: "json-snapshot" };
    } else if (mapping.refresh === 'interviews') {
      refreshResult = await refreshInterviews();
    }

    return NextResponse.json({ 
      success: true, 
      category,
      message: `File uploaded and processed successfully under ${category}.`,
      refreshResult 
    });

  } catch (error: any) {
    console.error("Unified upload error:", error);
    return NextResponse.json({ error: error.message || "Upload processing failed" }, { status: 500 });
  }
}
