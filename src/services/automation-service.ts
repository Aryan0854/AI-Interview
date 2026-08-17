import { join, basename } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import ExcelJS from 'exceljs';
import { supabase } from '@/lib/db';
import { resumeService } from '@/services/resume-service';
import { extractJdDetails } from '@/lib/jd-to-br/aiService';
import { writeLog } from '@/lib/structured-logger';
import { interviewCSVService } from '@/services/interview-csv-service';
import {
  ensureDocsStorage,
  listDocFiles,
  readDocFileBuffer,
  writeDocFile,
} from '@/lib/docs-storage';
import { writePersistedJson } from '@/lib/runtime-data';
import { calculateSkillMatch } from '@/lib/skill-match';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

export interface EmployeeRecord {
  employee_id: string;
  full_name: string;
  email: string;
  department: string;
  skills: string;
  product?: string;
  grade: string;
  designation: string;
  status: string;
  shortlisted: boolean;
  score: number;
  matchingSkills: string[];
}

/**
 * Ensures doc ingestion storage (local folders or Supabase docs-ingest bucket).
 */
export async function ensureDocsDirectories() {
  await ensureDocsStorage();
}

/**
 * Loads the base Excel BR template workbook
 */
async function loadTemplateWorkbook(): Promise<ExcelJS.Workbook> {
  const templatePath = join(getUploadsRoot(), "BR_RawData.xlsx");
  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = await readFile(templatePath);
    await workbook.xlsx.load(buffer as any);
    return workbook;
  } catch (e) {}
  
  // Blank workbook fallback
  const sheet = workbook.addWorksheet("BR _Raw Data");
  sheet.addRow([
    "Auto req ID", "Current Req Status", "Grade", "Designation", "Recruiter",
    "Department Type", "BU", "Client Interview?", "Mandatory Skills", "Entity",
    "Client Name", "Billing Type", "Project", "Requester ID", "TAG Manager",
    "RM Name", "Job description", "Joining Location", "Backfill for Employee Name",
    "Date Approved", "No. of Positions", "Positions Remaining", "Sourcing Type",
    "Requirement Type", "ST (Bill Rate) Enter only numeric value and 0 for Non-Billable"
  ]);
  return workbook;
}

/**
 * Helper to convert a custom BR ID/string (e.g. 46394BR) into a deterministic UUID format
 */
export function brIdToUuid(brId: string): string {
  if (!brId) return brId;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brId)) {
    return brId;
  }
  const hash = createHash('md5').update(brId).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

type ParsedBrRequirement = {
  autoReqId: string;
  designation: string;
  skills: string;
  jdBody: string;
  rmEmail: string;
  sourceFile: string;
  composedText: string;
};

function normalizeBrId(raw: string): string {
  const trimmed = String(raw || "").trim();
  const match = trimmed.match(/(\d+)\s*BR/i);
  if (match) return `${match[1]}BR`;
  if (/^\d{4,}$/.test(trimmed)) return `${trimmed}BR`;
  return "";
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (typeof value === "object" && value && "text" in (value as any)) {
    return String((value as any).text || "").trim();
  }
  if (typeof value === "object" && value && "richText" in (value as any)) {
    return ((value as any).richText || []).map((t: any) => t.text || "").join("").trim();
  }
  return String(value).trim();
}

function isBrDataSheet(name: string): boolean {
  const n = (name || "").toLowerCase();
  if (!n.trim()) return false;
  if (n.includes("pivot") || n.includes("summary")) return false;
  return true;
}

function composeRequirementText(designation: string, skills: string, jdBody: string): string {
  const parts: string[] = [];
  if (designation) parts.push(`Job Title: ${designation}`);
  if (skills) parts.push(`Mandatory Skills: ${skills}`);
  if (jdBody) parts.push(jdBody);
  return parts.join("\n\n").trim();
}

function parseBrWorkbook(workbook: ExcelJS.Workbook, sourceFile: string): ParsedBrRequirement[] {
  const parsed: ParsedBrRequirement[] = [];

  for (const sheet of workbook.worksheets) {
    if (!isBrDataSheet(sheet.name)) continue;

    const sheetData: any[][] = [];
    sheet.eachRow((row) => {
      sheetData.push(row.values as any[]);
    });
    if (sheetData.length === 0) continue;

    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(10, sheetData.length); i++) {
      const r = sheetData[i];
      if (!Array.isArray(r)) continue;
      const hasHeaders = r.some((h) => {
        if (!h) return false;
        const str = String(h).trim().toLowerCase();
        return str.includes("auto req id") || str.includes("br id");
      });
      if (hasHeaders) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx === -1) continue;

    const headerRow = sheetData[headerRowIdx] || [];
    const getColIndex = (names: string[]) => {
      const normalizedNames = names.map((n) => n.trim().toLowerCase().replace(/[_-]/g, " "));
      return headerRow.findIndex((h: any) => {
        if (!h) return false;
        const normalizedH = String(h).trim().toLowerCase().replace(/[_-]/g, " ");
        return normalizedNames.includes(normalizedH);
      });
    };
    const findColIdx = (namesInOrderOfPriority: string[]) => {
      for (const name of namesInOrderOfPriority) {
        const idx = getColIndex([name]);
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const idIdx = findColIdx(["auto req id", "br id", "id"]);
    if (idIdx === -1) continue;
    const titleIdx = findColIdx(["designation", "job title", "role", "position"]);
    const skillsIdx = findColIdx(["mandatory skills", "skills", "detailed skills"]);
    const jdIdx = findColIdx(["job description", "jd"]);
    const rmIdx = findColIdx(["rm name", "reporting manager"]);

    for (let r = headerRowIdx + 1; r < sheetData.length; r++) {
      const row = sheetData[r];
      if (!row) continue;
      const autoReqId = normalizeBrId(cellText(row[idIdx]));
      if (!autoReqId) continue;

      const designation = titleIdx !== -1 ? cellText(row[titleIdx]) : "";
      const skills = skillsIdx !== -1 ? cellText(row[skillsIdx]) : "";
      const jdBody = jdIdx !== -1 ? cellText(row[jdIdx]) : "";
      const rmRaw = rmIdx !== -1 ? cellText(row[rmIdx]) : "";
      const composedText = composeRequirementText(designation || "Technical Role", skills, jdBody);
      if (!composedText) continue;

      parsed.push({
        autoReqId,
        designation: designation || "Technical Role",
        skills,
        jdBody,
        rmEmail: rmRaw.includes("@") ? rmRaw.toLowerCase() : "admin@infinite.com",
        sourceFile,
        composedText,
      });
    }
  }

  return parsed;
}

function mergeBrRequirements(rows: ParsedBrRequirement[]): ParsedBrRequirement[] {
  const byId = new Map<string, ParsedBrRequirement>();
  for (const row of rows) {
    const prev = byId.get(row.autoReqId);
    if (!prev) {
      byId.set(row.autoReqId, row);
      continue;
    }
    const prevScore = prev.composedText.length + (prev.jdBody.length > 80 ? 500 : 0);
    const nextScore = row.composedText.length + (row.jdBody.length > 80 ? 500 : 0);
    if (nextScore > prevScore) {
      byId.set(row.autoReqId, row);
    }
  }

  const byText = new Map<string, ParsedBrRequirement[]>();
  for (const row of byId.values()) {
    const key = row.composedText.trim().toLowerCase().length < 40
      ? `id:${row.autoReqId}`
      : row.composedText.trim().toLowerCase();
    const list = byText.get(key) || [];
    list.push(row);
    byText.set(key, list);
  }
  const merged: ParsedBrRequirement[] = [];
  for (const list of byText.values()) {
    list.sort((a, b) => {
      const aScore = a.composedText.length + (a.jdBody.length > 80 ? 500 : 0);
      const bScore = b.composedText.length + (b.jdBody.length > 80 ? 500 : 0);
      return bScore - aScore;
    });
    merged.push(...list.slice(0, 2));
  }
  return merged;
}

/**
 * 1. Requirements Refresh: Scans /docs/BR and /docs/JD
 */
export async function refreshRequirements(): Promise<{ success: boolean; processedBRs: number; convertedJDs: number }> {
  await ensureDocsStorage();
  
  const brFiles = await listDocFiles("BR");
  const jdFiles = await listDocFiles("JD");
  
  let processedBRs = 0;
  let convertedJDs = 0;

  let localJds: any[] = [];
  const localJdPath = join(getUploadsRoot(), "job_descriptions.json");
  try {
    const raw = await readFile(localJdPath, "utf8");
    localJds = JSON.parse(raw);
  } catch (e) {}
  
  const xlsxBrFiles = brFiles.filter(f => f.endsWith(".xlsx") || f.endsWith(".xls"));
  const actualJdFiles = jdFiles.filter(f => f.endsWith(".pdf") || f.endsWith(".docx") || f.endsWith(".doc") || f.endsWith(".txt"));

  const parsedFromFiles: ParsedBrRequirement[] = [];

  // Scenario A & C: Parse every BR workbook (demand sheet + BR _Raw Data) and merge unique Auto Req IDs.
  for (const file of xlsxBrFiles) {
    try {
      const workbook = new ExcelJS.Workbook();
      const buffer = await readDocFileBuffer("BR", file);
      await workbook.xlsx.load(buffer as any);
      parsedFromFiles.push(...parseBrWorkbook(workbook, file));
    } catch (err: any) {
      await writeLog('requirements', 'PARSE_BR_FILE_FAILED', 'failed', `Failed parsing BR file ${file}: ${err.message}`);
    }
  }

  const mergedBrs = mergeBrRequirements(parsedFromFiles);
  await writeLog(
    'requirements',
    'MERGED_BR_FILES',
    'success',
    `Merged ${parsedFromFiles.length} BR rows from ${xlsxBrFiles.length} files into ${mergedBrs.length} unique Auto Req IDs`
  );

  const upsertRows = mergedBrs.map((row) => {
    const jdUuid = brIdToUuid(row.autoReqId);
    const newLocalJd = {
      id: jdUuid,
      jdText: row.composedText,
      rmEmail: row.rmEmail,
      fileName: `${row.autoReqId} | ${row.sourceFile}`,
      createdAt: new Date().toISOString()
    };
    const existingIdx = localJds.findIndex((j: any) => j.id === jdUuid);
    if (existingIdx !== -1) {
      localJds[existingIdx] = { ...localJds[existingIdx], ...newLocalJd, createdAt: localJds[existingIdx].createdAt || newLocalJd.createdAt };
    } else {
      localJds.push(newLocalJd);
    }
    return {
      id: jdUuid,
      jd_text: newLocalJd.jdText,
      rm_email: newLocalJd.rmEmail,
      file_name: newLocalJd.fileName,
      created_at: newLocalJd.createdAt
    };
  });

  for (let i = 0; i < upsertRows.length; i += 50) {
    const chunk = upsertRows.slice(i, i + 50);
    const { error } = await supabase.from('job_descriptions').upsert(chunk);
    if (error) {
      await writeLog('requirements', 'UPSERT_BR_ERROR', 'failed', `Error saving BR batch ${i}: ${error.message}`);
    } else {
      processedBRs += chunk.length;
    }
  }
  
  // Scenario B: If only JD exists in docs/JD, convert to BR and save to docs/BR
  for (const file of actualJdFiles) {
    // Check if BR already exists in docs/BR (same name ending with _BR.xlsx or same base name)
    const base = file.replace(/\.[^/.]+$/, "");
    const matchingBr = xlsxBrFiles.find(bf => bf.toLowerCase().startsWith(base.toLowerCase()) || bf.includes(base));
    if (matchingBr) {
      // Prioritize BR, skip JD conversion
      continue;
    }
    
    try {
      const buffer = await readDocFileBuffer("JD", file);
      const jdText = await resumeService.extractTextFromBuffer(buffer);
      
      if (!jdText.trim()) continue;
      
      // Call JD to BR extraction
      const details = await extractJdDetails(jdText, file);
      
      const newAutoReqId = details.auto_req_id || `${Math.floor(40000 + Math.random() * 9999)}BR`;
      const allSkills = [
        ...(details.skills || []),
        ...(details.monitoring_tools || []),
        ...(details.cloud_platforms || [])
      ];
      const uniqueSkills = [...new Set(allSkills)].join(', ');
      
      // Load spreadsheet template and append row
      const workbook = await loadTemplateWorkbook();
      const sheet = workbook.getWorksheet("BR _Raw Data") || workbook.worksheets[0];
      
      // Find last row
      let lastRow = 1;
      sheet.eachRow((row, rowNumber) => {
        lastRow = Math.max(lastRow, rowNumber);
      });
      const newRowIdx = lastRow + 1;
      const newRow = sheet.getRow(newRowIdx);
      
      // Standard BR Columns: ID, Status, Grade, Title, Recruiter, Dept, BU, Interview, Skills, Entity, Client, Billing, Project, Requester, TAG, RM, JD, Location
      newRow.getCell(1).value = newAutoReqId;
      newRow.getCell(2).value = "Open";
      newRow.getCell(3).value = details.experience?.includes("5") ? "E2" : "E1";
      newRow.getCell(4).value = details.job_title || "Technical Role";
      newRow.getCell(6).value = "Technical";
      newRow.getCell(7).value = "ITS - TMH - Delivery";
      newRow.getCell(8).value = "Yes";
      newRow.getCell(9).value = uniqueSkills;
      newRow.getCell(10).value = "OFFSHORE";
      newRow.getCell(11).value = "IRON MOUNTAIN";
      newRow.getCell(12).value = "Billable";
      newRow.getCell(13).value = "IM DXP-IDP 2025";
      newRow.getCell(16).value = "Hippargi, Anil (1017237)";
      newRow.getCell(17).value = jdText.substring(0, 5000);
      newRow.getCell(18).value = "Bangalore - Global Axis";
      newRow.commit();
      
      // Save converted BR spreadsheet back to BR folder
      const outputBrName = `${base}_BR.xlsx`;
      const finalBuffer = await workbook.xlsx.writeBuffer();
      await writeDocFile("BR", outputBrName, Buffer.from(finalBuffer as ArrayBuffer));
      
      const jdUuid = brIdToUuid(newAutoReqId);
      const newLocalJd = {
        id: jdUuid,
        jdText: jdText,
        rmEmail: "admin@infinite.com",
        fileName: `${newAutoReqId} | ${file}`,
        createdAt: new Date().toISOString()
      };
      const existingIdx = localJds.findIndex((j: any) => j.id === jdUuid);
      if (existingIdx !== -1) {
        localJds[existingIdx] = newLocalJd;
      } else {
        localJds.push(newLocalJd);
      }

      try {
        await supabase.from('job_descriptions').upsert({
          id: jdUuid,
          jd_text: jdText,
          rm_email: "admin@infinite.com",
          file_name: `${newAutoReqId} | ${file}`,
          created_at: newLocalJd.createdAt
        });
      } catch (dbErr) {
        console.warn("Failed to save converted JD to Supabase:", dbErr);
      }
      
      convertedJDs++;
      await writeLog('requirements', 'CONVERTED_JD_TO_BR', 'success', `Automatically converted JD ${file} to BR ${outputBrName}`);
    } catch (err: any) {
      await writeLog('requirements', 'CONVERT_JD_FAILED', 'failed', `Error converting JD ${file}: ${err.message}`);
    }
  }

  try {
    const serialized = JSON.stringify(localJds, null, 2);
    await writeFile(localJdPath, serialized, "utf8");
    await writePersistedJson("job_descriptions.json", serialized).catch((err) => {
      console.warn("Failed to persist job_descriptions.json to app-data:", err);
    });
  } catch (writeErr) {
    console.error("Failed to write local backup for requirements refresh:", writeErr);
  }
  
  return { success: true, processedBRs, convertedJDs };
}

/**
 * 2. Candidates Refresh: Scans /docs/Resumes
 */
export async function refreshCandidates(activeJdId?: string): Promise<{ success: boolean; processed: number; duplicates: number }> {
  await ensureDocsStorage();
  const files = await listDocFiles("Resumes");
  
  let processed = 0;
  let duplicates = 0;
  
  const resumeFiles = files.filter(f => f.endsWith(".pdf") || f.endsWith(".docx") || f.endsWith(".doc"));
  
  // Resolve JD
  let jdId = activeJdId;
  let jdText = "";
  if (!jdId || jdId === "all") {
    const { data: latestJd } = await supabase.from('job_descriptions').select('id, jd_text').order('created_at', { ascending: false }).limit(1);
    if (latestJd && latestJd.length > 0) {
      jdId = latestJd[0].id;
      jdText = latestJd[0].jd_text;
    }
  } else {
    const { data: dbJd } = await supabase.from('job_descriptions').select('jd_text').eq('id', jdId).single();
    if (dbJd) jdText = dbJd.jd_text;
  }
  
  for (const file of resumeFiles) {
    try {
      const buffer = await readDocFileBuffer("Resumes", file);
      
      // Compute hash
      const fileHash = createHash("sha256").update(buffer).digest("hex");
      
      // Prevent duplicates only if the resume was already processed for this exact JD
      const { data: existing } = await supabase.from('resumes').select('id, filename, report').eq('file_hash', fileHash);
      if (existing && existing.length > 0) {
        const existingJdId = existing[0].report?.jdId;
        if (existingJdId === jdId) {
          duplicates++;
          continue;
        }
      }
      
      // Construct mock File
      const mockFile = {
        name: file,
        arrayBuffer: async () => buffer
      } as unknown as File;
      
      // Process CV
      const result = await resumeService.processResumeSync(mockFile, jdText, jdId, "admin@infinite.com", false);
      processed++;
      
      const score = result.report?.jdMatchScore ?? result.analysis?.overallScore ?? 0;
      const isSuitable = score >= 40;
      const category = isSuitable ? "SUITABLE" : "UNSUITABLE";
      const candidateName = result.parsed?.personal?.fullName || file.replace(/\.[^/.]+$/, "");
      
      await writeLog('candidate-processing', `SCREENED_${category}_CANDIDATE`, 'success', `Candidate ${candidateName} matches ${score}% for JD ${jdId || 'latest'}`);
    } catch (err: any) {
      await writeLog('candidate-processing', 'SCREENING_FAILED', 'failed', `Error screening CV ${file}: ${err.message}`);
    }
  }
  
  return { success: true, processed, duplicates };
}

/**
 * 3. Employee Pool Refresh: Scans /docs/Corp Pool
 */
export async function refreshEmployees(activeJdId?: string): Promise<{ success: boolean; loaded: number }> {
  await ensureDocsStorage();
  const files = await listDocFiles("Corp Pool");
  
  let loaded = 0;
  const parsedEmployees: EmployeeRecord[] = [];
  
  // Resolve active JD skills for match score computation
  let jdSkills = "";
  let jdId = activeJdId;
  if (!jdId || jdId === "all") {
    const { data: latestJd } = await supabase.from('job_descriptions').select('id, jd_text').order('created_at', { ascending: false }).limit(1);
    if (latestJd && latestJd.length > 0) {
      jdId = latestJd[0].id;
      jdSkills = latestJd[0].jd_text;
    }
  } else {
    const { data: dbJd } = await supabase.from('job_descriptions').select('jd_text').eq('id', jdId).single();
    if (dbJd) jdSkills = dbJd.jd_text;
  }
  
  const csvFiles = files.filter(f => f.endsWith(".csv"));
  const xlsxFiles = files.filter(f => f.endsWith(".xlsx") || f.endsWith(".xls"));
  
  // Helper to sync record to Supabase
  const syncToSupabase = async (emp: EmployeeRecord) => {
    try {
      await supabase.from('employees').upsert({
        employee_id: emp.employee_id,
        email: emp.email || `${emp.employee_id}@example.com`,
        full_name: emp.full_name,
        department: emp.department || 'engineering',
        role: 'employee',
        skill_level: emp.score >= 70 ? 'advanced' : (emp.score >= 40 ? 'intermediate' : 'beginner'),
        ai_readiness_score: emp.score || 0,
        is_first_login: false,
        updated_at: new Date().toISOString()
      });
    } catch (e) {}
  };
  
  // A. Process Excel files
  for (const file of xlsxFiles) {
    try {
      const buffer = await readDocFileBuffer("Corp Pool", file);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      
      let sheet = workbook.worksheets[0];
      let rows: any[][] = [];
      let headerRow: any[] = [];
      let headerRowIdx = -1;
      
      // Find a worksheet that has headers resembling employee columns
      for (const ws of workbook.worksheets) {
        const tempRows: any[][] = [];
        ws.eachRow((row) => {
          tempRows.push(row.values as any[]);
        });
        
        if (tempRows.length > 0) {
          let foundIdx = -1;
          const maxRowsToCheck = Math.min(10, tempRows.length);
          for (let i = 0; i < maxRowsToCheck; i++) {
            const r = tempRows[i];
            if (Array.isArray(r)) {
              const hasHeaders = r.some(h => {
                if (!h) return false;
                const str = String(h).trim().toLowerCase();
                return str.includes("emp no") || str.includes("emp_no") || str.includes("employee id") || str.includes("emp name") || str.includes("employee name");
              });
              if (hasHeaders) {
                foundIdx = i;
                break;
              }
            }
          }
          
          if (foundIdx !== -1) {
            sheet = ws;
            rows = tempRows;
            headerRowIdx = foundIdx;
            headerRow = tempRows[foundIdx];
            break;
          }
        }
      }
      
      if (headerRowIdx === -1 && workbook.worksheets.length > 0) {
        sheet = workbook.worksheets[0];
        rows = [];
        sheet.eachRow((row) => {
          rows.push(row.values as any[]);
        });
        headerRowIdx = 0;
        headerRow = rows[0] || [];
      }
      
      if (rows.length <= headerRowIdx + 1) continue;
      
      const getIdx = (names: string[]) => {
        const normalizedNames = names.map(n => n.trim().toLowerCase().replace(/[_-]/g, ' '));
        return headerRow.findIndex((h: any) => {
          if (!h) return false;
          const normalizedH = String(h).trim().toLowerCase().replace(/[_-]/g, ' ');
          return normalizedNames.includes(normalizedH);
        });
      };
      
      const findColumnIdx = (namesInOrderOfPriority: string[]) => {
        for (const name of namesInOrderOfPriority) {
          const idx = getIdx([name]);
          if (idx !== -1) return idx;
        }
        return -1;
      };
      
      const idIdx = findColumnIdx(["emp no", "employee id", "emp id", "id"]);
      const nameIdx = findColumnIdx(["emp name", "employee name", "name"]);
      const deptIdx = findColumnIdx(["business unit", "sbu", "bu", "department", "dept"]);
      const skillsIdx = findColumnIdx(["detailed skills", "skills bucket", "top 3 skills", "skills"]);
      const statusIdx = findColumnIdx(["status", "availability"]);
      const gradeIdx = findColumnIdx(["grade", "level"]);
      const mailIdx = findColumnIdx(["official mail id", "email", "mail id"]);
      const roleIdx = findColumnIdx(["designation", "role", "position"]);
      
      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;
        
        const empNo = idIdx !== -1 && row[idIdx] ? String(row[idIdx]).trim() : `EMP${Math.floor(1000 + Math.random()*9000)}`;
        const empName = nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : "Unknown Employee";
        const department = deptIdx !== -1 && row[deptIdx] ? String(row[deptIdx]).trim() : "Engineering";
        const skills = skillsIdx !== -1 && row[skillsIdx] ? String(row[skillsIdx]).trim() : "";
        const status = statusIdx !== -1 && row[statusIdx] ? String(row[statusIdx]).trim() : "Active";
        const grade = gradeIdx !== -1 && row[gradeIdx] ? String(row[gradeIdx]).trim() : "E1";
        const email = mailIdx !== -1 && row[mailIdx] ? String(row[mailIdx]).trim() : "";
        const designation = roleIdx !== -1 && row[roleIdx] ? String(row[roleIdx]).trim() : "Support Engineer";
        
        const matchResult = calculateSkillMatch(skills, jdSkills);
        
        const record: EmployeeRecord = {
          employee_id: empNo,
          full_name: empName,
          email: email || `${empNo}@example.com`,
          department,
          skills,
          grade,
          designation,
          status,
          shortlisted: false,
          score: matchResult.score,
          matchingSkills: matchResult.matchingSkills
        };
        
        parsedEmployees.push(record);
        await syncToSupabase(record);
        loaded++;
      }
    } catch (err: any) {
      await writeLog('employee', 'PARSE_EXCEL_FAILED', 'failed', `Error parsing xlsx employee pool ${file}: ${err.message}`);
    }
  }
  
  // B. Process CSV files
  for (const file of csvFiles) {
    try {
      const csvContent = (await readDocFileBuffer("Corp Pool", file)).toString("utf8");
      const lines = csvContent.split("\n").filter(Boolean);
      if (lines.length <= 1) continue;
      
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/"/g, ''));
      const getIdx = (names: string[]) => {
        const normalizedNames = names.map(n => n.trim().toLowerCase().replace(/[_-]/g, ' '));
        return headers.findIndex((h: string) => {
          if (!h) return false;
          const normalizedH = h.trim().toLowerCase().replace(/[_-]/g, ' ');
          return normalizedNames.includes(normalizedH);
        });
      };
      
      const findColumnIdx = (namesInOrderOfPriority: string[]) => {
        for (const name of namesInOrderOfPriority) {
          const idx = getIdx([name]);
          if (idx !== -1) return idx;
        }
        return -1;
      };
      
      const idIdx = findColumnIdx(["emp no", "employee id", "emp id", "id"]);
      const nameIdx = findColumnIdx(["emp name", "employee name", "name"]);
      const deptIdx = findColumnIdx(["business unit", "sbu", "bu", "department", "dept"]);
      const skillsIdx = findColumnIdx(["detailed skills", "skills bucket", "top 3 skills", "skills"]);
      const statusIdx = findColumnIdx(["status", "availability"]);
      const gradeIdx = findColumnIdx(["grade", "level"]);
      const mailIdx = findColumnIdx(["official mail id", "email", "mail id"]);
      const roleIdx = findColumnIdx(["designation", "role", "position"]);
      
      for (let r = 1; r < lines.length; r++) {
        const line = lines[r];
        const cells = line.split(",").map(c => c.trim().replace(/"/g, ''));
        if (cells.length === 0 || cells.every(c => c === '')) continue;
        
        const empNo = idIdx !== -1 && cells[idIdx] ? cells[idIdx] : `EMP${Math.floor(1000 + Math.random()*9000)}`;
        const empName = nameIdx !== -1 && cells[nameIdx] ? cells[nameIdx] : "Unknown Employee";
        const department = deptIdx !== -1 && cells[deptIdx] ? cells[deptIdx] : "Engineering";
        const skills = skillsIdx !== -1 && cells[skillsIdx] ? cells[skillsIdx] : "";
        const status = statusIdx !== -1 && cells[statusIdx] ? cells[statusIdx].trim() : "Active";
        const grade = gradeIdx !== -1 && cells[gradeIdx] ? cells[gradeIdx] : "E1";
        const email = mailIdx !== -1 && cells[mailIdx] ? cells[mailIdx] : "";
        const designation = roleIdx !== -1 && cells[roleIdx] ? cells[roleIdx] : "Support Engineer";
        
        const matchResult = calculateSkillMatch(skills, jdSkills);
        
        const record: EmployeeRecord = {
          employee_id: empNo,
          full_name: empName,
          email: email || `${empNo}@example.com`,
          department,
          skills,
          grade,
          designation,
          status,
          shortlisted: false,
          score: matchResult.score,
          matchingSkills: matchResult.matchingSkills
        };
        
        parsedEmployees.push(record);
        await syncToSupabase(record);
        loaded++;
      }
    } catch (err: any) {
      await writeLog('employee', 'PARSE_CSV_FAILED', 'failed', `Error parsing csv employee pool ${file}: ${err.message}`);
    }
  }
  
  // De-duplicate parsedEmployees by employee_id to avoid key collision
  const seen = new Set<string>();
  const uniqueParsedEmployees: EmployeeRecord[] = [];
  for (const emp of parsedEmployees) {
    if (!seen.has(emp.employee_id)) {
      seen.add(emp.employee_id);
      uniqueParsedEmployees.push(emp);
    }
  }
  
  loaded = uniqueParsedEmployees.length;

  // Read existing employees from JSON to preserve shortlisted state
  let finalEmployees = uniqueParsedEmployees;
  const jsonPath = join(getUploadsRoot(), "employees.json");
  try {
    const raw = await readFile(jsonPath, "utf8");
    const existingList = JSON.parse(raw) as EmployeeRecord[];
    finalEmployees = uniqueParsedEmployees.map(parsed => {
      const match = existingList.find(e => e.employee_id === parsed.employee_id);
      return {
        ...parsed,
        shortlisted: match ? match.shortlisted : false
      };
    });
  } catch (e) {}
  
  // Save enriched records (local + cloud app-data so Vercel keeps skills)
  const serialized = JSON.stringify(finalEmployees, null, 2);
  await writeFile(jsonPath, serialized, "utf8");
  await writePersistedJson("employees.json", serialized).catch((err) => {
    console.warn("Failed to persist employees.json to app-data:", err);
  });
  await writeLog('employee', 'SYNC_EMPLOYEE_POOL', 'success', `Successfully loaded ${loaded} employees from /docs/Corp Pool`);
  
  return { success: true, loaded };
}

/**
 * 4. Refresh Interviews: Synchronizes CSV, statuses and results
 */
export async function refreshInterviews(): Promise<{ success: boolean; count: number }> {
  try {
    await interviewCSVService.syncAllInterviewsToCSV();
    
    // Read the sync results
    const csvContent = await interviewCSVService.getCSVContent();
    const rowsCount = csvContent.split('\n').filter(Boolean).length - 1; // subtract headers
    
    await writeLog('interview', 'REFRESH_INTERVIEWS', 'success', `Successfully synchronized ${rowsCount} interview rows to CSV`);
    return { success: true, count: rowsCount };
  } catch (err: any) {
    await writeLog('interview', 'REFRESH_INTERVIEWS_FAILED', 'failed', `Failed to sync interview CSV: ${err.message}`);
    return { success: false, count: 0 };
  }
}
