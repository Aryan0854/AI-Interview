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
  refreshInterviews 
} from '@/services/automation-service';

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
  interview: { refresh: "interviews" },
};

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
    const category = formData.get('category') as string || '';
    const activeJdId = formData.get('activeJdId') as string || undefined;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const mapping = CATEGORY_MAP[category];
    if (!mapping) {
      return NextResponse.json({ error: "Invalid upload category" }, { status: 400 });
    }

    const filename = file.name;
    const buffer = Buffer.from(await file.arrayBuffer());

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
          ? { incomingBrFiles: [filename] }
          : category === "jd"
            ? { incomingJdFiles: [filename] }
            : undefined
      );
      if (
        category === "jd" &&
        Number(refreshResult.convertedJDs || 0) === 0 &&
        Number(refreshResult.processedBRs || 0) === 0
      ) {
        throw new Error(
          "The file was stored, but it could not be added to Requirements. Check System Logs, or the BR ID may still be blocked."
        );
      }
    } else if (mapping.refresh === 'candidates') {
      refreshResult = await refreshCandidates(activeJdId);
    } else if (mapping.refresh === 'employees') {
      refreshResult = await refreshEmployees(activeJdId);
    } else if (mapping.refresh === 'interviews') {
      refreshResult = await refreshInterviews();
    }

    return NextResponse.json({ 
      success: true, 
      message: `File uploaded and processed successfully under ${category}.`,
      refreshResult 
    });

  } catch (error: any) {
    console.error("Unified upload error:", error);
    return NextResponse.json({ error: error.message || "Upload processing failed" }, { status: 500 });
  }
}
