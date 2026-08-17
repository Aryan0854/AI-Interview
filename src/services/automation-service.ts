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
import { calculateSkillMatch, employeeMatchText } from '@/lib/skill-match';

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

const MASTER_BR_FILENAME = "BR_RawData 3.xlsx";

function headerKey(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ");
}

function getGradeFromExperience(expStr: string | undefined | null): string {
  if (!expStr) return "E2";
  const numbers = expStr.match(/\d+(\.\d+)?/g);
  if (!numbers || numbers.length === 0) return "E2";
  const years = parseFloat(numbers[0]);
  if (years >= 0 && years < 1) return "E0";
  if (years >= 1 && years < 3) return "E1";
  if (years >= 3 && years < 6) return "E2";
  if (years >= 6 && years < 9) return "E3";
  if (years >= 9 && years < 12) return "E4";
  if (years >= 12) return "E5/E6";
  return "E2";
}

function readSheetHeaders(sheet: ExcelJS.Worksheet): Map<string, number> {
  const byKey = new Map<string, number>();
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    const name = cellText(cell.value);
    if (name) byKey.set(headerKey(name), col);
  });
  return byKey;
}

function headerCol(byKey: Map<string, number>, ...aliases: string[]): number | undefined {
  for (const alias of aliases) {
    const col = byKey.get(headerKey(alias));
    if (col) return col;
  }
  return undefined;
}

function lastUsedRow(sheet: ExcelJS.Worksheet): number {
  let last = 1;
  sheet.eachRow((row, n) => {
    let has = false;
    row.eachCell({ includeEmpty: false }, () => {
      has = true;
    });
    if (has) last = Math.max(last, n);
  });
  return last;
}

function collectSheetAutoReqIds(sheet: ExcelJS.Worksheet, idCol?: number): Set<string> {
  const ids = new Set<string>();
  if (!idCol) return ids;
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const id = normalizeBrId(cellText(row.getCell(idCol).value));
    if (id) ids.add(id);
  });
  return ids;
}

function nextAutoReqId(existing: Set<string>): string {
  let max = 40000;
  for (const id of existing) {
    const match = id.match(/(\d+)/);
    if (!match) continue;
    const num = parseInt(match[1], 10);
    if (Number.isFinite(num) && num > max) max = num;
  }
  return `${max + 1}BR`;
}

function copyRowStyle(fromRow: ExcelJS.Row, toRow: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const templateCell = fromRow.getCell(c);
    const newCell = toRow.getCell(c);
    if (!templateCell) continue;
    try {
      newCell.font = templateCell.font ? JSON.parse(JSON.stringify(templateCell.font)) : undefined;
      newCell.fill = templateCell.fill ? JSON.parse(JSON.stringify(templateCell.fill)) : undefined;
      newCell.border = templateCell.border ? JSON.parse(JSON.stringify(templateCell.border)) : undefined;
      newCell.alignment = templateCell.alignment ? JSON.parse(JSON.stringify(templateCell.alignment)) : undefined;
      newCell.numFmt = templateCell.numFmt;
    } catch {
      // style copy is best-effort
    }
  }
}

function writeMappedRow(
  sheet: ExcelJS.Worksheet,
  byKey: Map<string, number>,
  values: Record<string, unknown>,
  existingRow?: ExcelJS.Row
): ExcelJS.Row {
  const colCount = Math.max(sheet.columnCount || 25, 25);
  const row =
    existingRow ||
    sheet.getRow(lastUsedRow(sheet) + 1);
  const templateRow = sheet.getRow(Math.max(2, lastUsedRow(sheet)));
  if (!existingRow) copyRowStyle(templateRow, row, colCount);

  for (const [header, value] of Object.entries(values)) {
    const col = headerCol(byKey, header);
    if (!col) continue;
    row.getCell(col).value = value as ExcelJS.CellValue;
  }
  row.commit();
  return row;
}

function jdExtractedFieldMap(opts: {
  autoReqId: string;
  details: any;
  jdText: string;
  rmName?: string;
}): Record<string, unknown> {
  const { autoReqId, details, jdText, rmName } = opts;
  const allSkills = [
    ...(details.skills || []),
    ...(details.monitoring_tools || []),
    ...(details.cloud_platforms || []),
    ...(details.tools || []),
  ];
  const uniqueSkills = [...new Set(allSkills.filter(Boolean))].join(", ");
  return {
    "Auto req ID": autoReqId,
    "Current Req Status": "Open",
    Grade: getGradeFromExperience(details.experience),
    Designation: details.job_title || "Technical Role",
    Recruiter: details.recruiter || "",
    "Department Type": details.department || "Technical",
    BU: "ITS - TMH - Delivery",
    "Client Interview?": "Yes",
    "Mandatory Skills": uniqueSkills,
    Entity: "OFFSHORE",
    "Client Name": "IRON MOUNTAIN",
    "Billing Type": "Billable",
    Project: "IM DXP-IDP 2025",
    "Requester ID": "1026374",
    "TAG Manager": "Antony, Nithin (1027544)",
    "RM Name": rmName || "Hippargi, Anil (1017237)",
    "Job description": String(jdText || "").substring(0, 5000),
    "Joining Location": "Bangalore - Global Axis",
    "Date Approved": new Date().toISOString().split("T")[0],
    "No. of Positions": 1,
    "Positions Remaining": 1,
    "Sourcing Type": "External - India",
    "Requirement Type": "New",
    "ST (Bill Rate) Enter only numeric value and 0 for Non-Billable": 5.5,
  };
}

function findMasterBrSheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet {
  const preferred = ["BR _Raw Data", "BR_Raw Data", "Global TMH Demand"];
  for (const name of preferred) {
    const sheet = workbook.getWorksheet(name);
    if (sheet) return sheet;
  }
  for (const sheet of workbook.worksheets) {
    if (isBrDataSheet(sheet.name) && readSheetHeaders(sheet).has(headerKey("Auto req ID"))) {
      return sheet;
    }
  }
  return workbook.worksheets[0] || workbook.addWorksheet("BR _Raw Data");
}

async function loadMasterBrWorkbook(): Promise<{ workbook: ExcelJS.Workbook; filename: string }> {
  const files = await listDocFiles("BR");
  const filename =
    files.find((f) => f.toLowerCase() === MASTER_BR_FILENAME.toLowerCase()) ||
    files.find((f) => /br_rawdata/i.test(f.replace(/\s+/g, "_"))) ||
    MASTER_BR_FILENAME;

  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = await readDocFileBuffer("BR", filename);
    await workbook.xlsx.load(buffer as any);
    if (workbook.worksheets.length === 0) {
      return { workbook: await loadTemplateWorkbook(), filename: MASTER_BR_FILENAME };
    }
    return { workbook, filename: MASTER_BR_FILENAME };
  } catch {
    return { workbook: await loadTemplateWorkbook(), filename: MASTER_BR_FILENAME };
  }
}

async function saveMasterBrWorkbook(workbook: ExcelJS.Workbook, filename = MASTER_BR_FILENAME): Promise<void> {
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  await writeDocFile("BR", filename, buffer);
}

function appendBrWorkbookRows(
  source: ExcelJS.Workbook,
  masterSheet: ExcelJS.Worksheet,
  masterHeaders: Map<string, number>,
  existingIds: Set<string>
): number {
  let added = 0;
  const masterColCount = Math.max(masterSheet.columnCount || 25, 25);
  const templateRow = masterSheet.getRow(Math.max(2, lastUsedRow(masterSheet)));

  for (const sheet of source.worksheets) {
    if (!isBrDataSheet(sheet.name)) continue;
    const sourceHeaders = readSheetHeaders(sheet);
    const idCol = headerCol(sourceHeaders, "auto req id", "br id", "id");
    if (!idCol) continue;

    sheet.eachRow((row, n) => {
      if (n === 1) return;
      const autoReqId = normalizeBrId(cellText(row.getCell(idCol).value));
      if (!autoReqId || existingIds.has(autoReqId)) return;

      const newRow = masterSheet.getRow(lastUsedRow(masterSheet) + 1);
      copyRowStyle(templateRow, newRow, masterColCount);

      sourceHeaders.forEach((srcCol, key) => {
        const destCol = masterHeaders.get(key);
        if (!destCol) return;
        const value = row.getCell(srcCol).value;
        if (value !== undefined && value !== null && value !== "") {
          newRow.getCell(destCol).value = value as ExcelJS.CellValue;
        }
      });

      const destIdCol = headerCol(masterHeaders, "auto req id", "br id", "id");
      if (destIdCol) newRow.getCell(destIdCol).value = autoReqId;
      newRow.commit();
      existingIds.add(autoReqId);
      added++;
    });
  }
  return added;
}

function findRowByAutoReqId(sheet: ExcelJS.Worksheet, idCol: number, autoReqId: string): ExcelJS.Row | undefined {
  let found: ExcelJS.Row | undefined;
  sheet.eachRow((row, n) => {
    if (n === 1 || found) return;
    if (normalizeBrId(cellText(row.getCell(idCol).value)) === autoReqId) found = row;
  });
  return found;
}

function autoReqIdFromLabel(fileName?: string): string {
  return normalizeBrId(String(fileName || "").split("|")[0] || "");
}

async function persistMasterRequirements(
  workbook: ExcelJS.Workbook,
  filename: string,
  localJds: any[]
): Promise<number> {
  const merged = mergeBrRequirements(parseBrWorkbook(workbook, filename));
  const upsertRows = merged.map((row) => {
    const jdUuid = brIdToUuid(row.autoReqId);
    const newLocalJd = {
      id: jdUuid,
      jdText: row.composedText,
      rmEmail: row.rmEmail,
      fileName: `${row.autoReqId} | ${filename}`,
      createdAt: new Date().toISOString(),
    };
    const existingIdx = localJds.findIndex((j: any) => j.id === jdUuid);
    if (existingIdx !== -1) {
      localJds[existingIdx] = {
        ...localJds[existingIdx],
        ...newLocalJd,
        createdAt: localJds[existingIdx].createdAt || newLocalJd.createdAt,
      };
    } else {
      localJds.push(newLocalJd);
    }
    return {
      id: jdUuid,
      jd_text: newLocalJd.jdText,
      rm_email: newLocalJd.rmEmail,
      file_name: newLocalJd.fileName,
      created_at: localJds.find((j: any) => j.id === jdUuid)?.createdAt || newLocalJd.createdAt,
    };
  });

  let processed = 0;
  for (let i = 0; i < upsertRows.length; i += 50) {
    const chunk = upsertRows.slice(i, i + 50);
    const { error } = await supabase.from("job_descriptions").upsert(chunk);
    if (error) {
      await writeLog("requirements", "UPSERT_BR_ERROR", "failed", `Error saving BR batch ${i}: ${error.message}`);
    } else {
      processed += chunk.length;
    }
  }
  return processed;
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
 * JD uploads are converted and appended into the master BR workbook.
 * Other BR workbooks are merged into that same master file, then saved to storage + DB.
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
  } catch {}

  const xlsxBrFiles = brFiles.filter((f) => f.endsWith(".xlsx") || f.endsWith(".xls"));
  const actualJdFiles = jdFiles.filter(
    (f) => f.endsWith(".pdf") || f.endsWith(".docx") || f.endsWith(".doc") || f.endsWith(".txt")
  );

  const { workbook: masterWorkbook, filename: masterFilename } = await loadMasterBrWorkbook();
  const masterSheet = findMasterBrSheet(masterWorkbook);
  const masterHeaders = readSheetHeaders(masterSheet);
  const idCol = headerCol(masterHeaders, "auto req id", "br id", "id");
  const existingIds = collectSheetAutoReqIds(masterSheet, idCol);

  for (const file of xlsxBrFiles) {
    if (file.toLowerCase() === masterFilename.toLowerCase()) continue;
    try {
      const source = new ExcelJS.Workbook();
      const buffer = await readDocFileBuffer("BR", file);
      await source.xlsx.load(buffer as any);
      const added = appendBrWorkbookRows(source, masterSheet, masterHeaders, existingIds);
      if (added > 0) {
        await writeLog(
          "requirements",
          "MERGED_BR_INTO_MASTER",
          "success",
          `Appended ${added} BR row(s) from ${file} into ${masterFilename}`
        );
      }
    } catch (err: any) {
      await writeLog("requirements", "PARSE_BR_FILE_FAILED", "failed", `Failed parsing BR file ${file}: ${err.message}`);
    }
  }

  for (const file of actualJdFiles) {
    try {
      const alreadyLinked = localJds.some(
        (j: any) => String(j.fileName || "").toLowerCase().includes(file.toLowerCase())
      );
      const buffer = await readDocFileBuffer("JD", file);
      const jdText = await resumeService.extractTextFromBuffer(buffer);
      if (!jdText.trim()) continue;

      const details = await extractJdDetails(jdText, file);
      const linkedId = autoReqIdFromLabel(
        localJds.find((j: any) => String(j.fileName || "").toLowerCase().includes(file.toLowerCase()))?.fileName
      );
      const autoReqId =
        (details.auto_req_id && normalizeBrId(details.auto_req_id)) ||
        linkedId ||
        (alreadyLinked ? "" : nextAutoReqId(existingIds));
      if (!autoReqId) continue;

      const existingRow = idCol ? findRowByAutoReqId(masterSheet, idCol, autoReqId) : undefined;
      writeMappedRow(
        masterSheet,
        masterHeaders,
        jdExtractedFieldMap({ autoReqId, details, jdText }),
        existingRow
      );
      existingIds.add(autoReqId);
      convertedJDs++;
      await writeLog(
        "requirements",
        "CONVERTED_JD_TO_BR",
        "success",
        `Converted JD ${file} into ${masterFilename} as ${autoReqId}`
      );
    } catch (err: any) {
      await writeLog("requirements", "CONVERT_JD_FAILED", "failed", `Error converting JD ${file}: ${err.message}`);
    }
  }

  await saveMasterBrWorkbook(masterWorkbook, masterFilename);
  processedBRs = await persistMasterRequirements(masterWorkbook, masterFilename, localJds);

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
 * When an admin selects a requirement, append it into the master BR workbook if missing,
 * then persist the workbook and job_descriptions row.
 */
export async function syncSelectedRequirementToMaster(jdId: string): Promise<{
  success: boolean;
  appended: boolean;
  autoReqId: string;
}> {
  if (!jdId || jdId === "all" || jdId.includes("@")) {
    return { success: true, appended: false, autoReqId: "" };
  }

  await ensureDocsStorage();
  const { data: dbJd, error } = await supabase
    .from("job_descriptions")
    .select("id, jd_text, file_name, rm_email")
    .eq("id", jdId)
    .maybeSingle();
  if (error || !dbJd) {
    throw new Error(error?.message || "Requirement not found");
  }

  const jdText = String(dbJd.jd_text || "").trim();
  if (!jdText) return { success: true, appended: false, autoReqId: "" };

  const { workbook, filename } = await loadMasterBrWorkbook();
  const sheet = findMasterBrSheet(workbook);
  const headers = readSheetHeaders(sheet);
  const idCol = headerCol(headers, "auto req id", "br id", "id");
  const existingIds = collectSheetAutoReqIds(sheet, idCol);

  let autoReqId = autoReqIdFromLabel(dbJd.file_name);
  if (autoReqId && existingIds.has(autoReqId)) {
    return { success: true, appended: false, autoReqId };
  }

  const details = await extractJdDetails(jdText, dbJd.file_name || "");
  if (!autoReqId) autoReqId = nextAutoReqId(existingIds);

  writeMappedRow(
    sheet,
    headers,
    jdExtractedFieldMap({
      autoReqId,
      details,
      jdText,
      rmName: dbJd.rm_email,
    })
  );
  await saveMasterBrWorkbook(workbook, filename);

  let localJds: any[] = [];
  const localJdPath = join(getUploadsRoot(), "job_descriptions.json");
  try {
    localJds = JSON.parse(await readFile(localJdPath, "utf8"));
  } catch {}
  await persistMasterRequirements(workbook, filename, localJds);
  try {
    const serialized = JSON.stringify(localJds, null, 2);
    await writeFile(localJdPath, serialized, "utf8");
    await writePersistedJson("job_descriptions.json", serialized).catch(() => {});
  } catch {}

  await writeLog(
    "requirements",
    "SYNC_SELECTED_BR_TO_MASTER",
    "success",
    `Appended selected requirement ${autoReqId} into ${filename}`
  );
  return { success: true, appended: true, autoReqId };
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
        
        const matchResult = calculateSkillMatch(
          employeeMatchText({ skills, designation, grade }),
          jdSkills
        );
        
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
        
        const matchResult = calculateSkillMatch(
          employeeMatchText({ skills, designation, grade }),
          jdSkills
        );
        
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
