import { join, basename } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import ExcelJS from 'exceljs';
import AdmZip from 'adm-zip';
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
  deleteDocFile,
} from '@/lib/docs-storage';
import { writePersistedJson, readPersistedJson } from '@/lib/runtime-data';
import { cacheStore } from '@/lib/cache-store';
import { calculateSkillMatch, employeeMatchText } from '@/lib/skill-match';
import { isRequirementDeleted, loadDeletedRequirements, unmarkRequirementsDeleted } from '@/lib/deleted-requirements';
import { isCorpPoolDeleted, loadDeletedCorpPool, unmarkCorpPoolDeleted } from '@/lib/deleted-corp-pool';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

const MASTER_BR_FILENAME = "BR_RawData 3.xlsx";
const JD_DOCUMENT_EXT = /\.(docx|doc|pdf|txt)$/i;

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
  source_file?: string;
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

function decodeSpreadsheetText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.slice(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1];
      swapped[i - 1] = buffer[i];
    }
    return swapped.toString("utf16le");
  }
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells.map((cell) => cell.replace(/^"|"$/g, "").trim());
}

function detectCsvDelimiter(headerLine: string): string {
  const candidates: Array<[string, number]> = [
    [",", (headerLine.match(/,/g) || []).length],
    [";", (headerLine.match(/;/g) || []).length],
    ["\t", (headerLine.match(/\t/g) || []).length],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0][1] > 0 ? candidates[0][0] : ",";
}

function parseCorpPoolCsv(buffer: Buffer): string[][] {
  const text = decodeSpreadsheetText(buffer);
  const rawLines = text.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim());
  if (rawLines.length === 0) return [];
  const delimiter = detectCsvDelimiter(rawLines[0]);
  return rawLines.map((line) => parseCsvLine(line, delimiter));
}

function isLikelyPhoneNumber(value: string): boolean {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 10 || digits.length === 11 || digits.length === 12;
}

function isGeneratedCorpPoolId(value: string): boolean {
  return /^CV[a-f0-9]{8,}$/i.test(String(value || "").trim());
}

function isLikelyYear(value: string): boolean {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 4) return false;
  const year = Number(digits);
  return year >= 1970 && year <= 2035;
}

function isPlausibleEmployeeId(value: string): boolean {
  const id = String(value || "").trim();
  if (!/^[A-Za-z]?\d{4,12}$/.test(id)) return false;
  if (isLikelyPhoneNumber(id) || isLikelyYear(id)) return false;
  return true;
}

function extractEmployeeIdFromCv(text: string, file: string): string {
  const normalized = String(text || "").replace(/\u00a0/g, " ");
  const patterns = [
    /employee\s*(?:id|code|number|no)\s*[:#.\-|]*\s*([A-Za-z]?\d{4,12})\b/i,
    /emp(?:loyee)?\s*(?:id|no|code|number)\s*[:#.\-|]*\s*([A-Za-z]?\d{4,12})\b/i,
    /staff\s*(?:id|code|no)\s*[:#.\-|]*\s*([A-Za-z]?\d{4,12})\b/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1] && isPlausibleEmployeeId(match[1])) return match[1].trim();
  }

  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < Math.min(lines.length - 1, 20); i++) {
    if (/^(employee\s*(?:id|code|number|no)|emp(?:loyee)?\s*(?:id|no)|staff\s*id)\s*[:#.\-]*$/i.test(lines[i])) {
      const next = lines[i + 1].match(/^([A-Za-z]?\d{4,12})\b/);
      if (next?.[1] && isPlausibleEmployeeId(next[1])) return next[1];
    }
  }

  const nearby = normalized.match(/employee\s*id[\s\S]{0,120}?(\d{5,10})/i);
  if (nearby?.[1] && isPlausibleEmployeeId(nearby[1])) return nearby[1];

  const fromFile = String(file || "").match(/\b([A-Za-z]?\d{5,10})\b/);
  if (fromFile?.[1] && isPlausibleEmployeeId(fromFile[1])) return fromFile[1];

  // Infinite CVs often start with "1033925 Jithender" and never say "Employee ID".
  for (const line of lines.slice(0, 12)) {
    const leading = line.match(/^([A-Za-z]?\d{5,8})(?:\s+[A-Za-z].*)?$/);
    if (leading?.[1] && isPlausibleEmployeeId(leading[1])) return leading[1];
  }
  return "";
}

const CV_NAME_BLOCKLIST =
  /^(career objectives?|objective|summary|professional summary|profile|experience|work experience|education|skills|technical skills|contact|contacts|declaration|projects|certifications?|about me|resume|curriculum vitae|personal details|employment history|key skills|highlights|achievements?)$/i;

function stripLeadingEmployeeId(value: string): { id: string; rest: string } {
  const match = String(value || "").trim().match(/^([A-Za-z]?\d{5,12})\s+(.+)$/);
  if (match?.[1] && isPlausibleEmployeeId(match[1])) {
    return { id: match[1], rest: match[2].trim() };
  }
  return { id: "", rest: String(value || "").trim() };
}

function looksLikePersonName(line: string): boolean {
  const raw = String(line || "").replace(/\s+/g, " ").trim();
  const text = stripLeadingEmployeeId(raw).rest.replace(/[!|]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text || CV_NAME_BLOCKLIST.test(text)) return false;
  if (text.length < 3 || text.length > 50) return false;
  if (/@|https?:|www\./i.test(text)) return false;
  if (/[|]/.test(raw)) return false;
  if (/^(successfully|experienced|worked|developed|led|responsible|managed|supporting)\b/i.test(text)) return false;
  const words = text.split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  if (words.length === 1 && words[0].length < 3) return false;
  if (words.some((word) => /^20\d{2}$/.test(word) || /^infinite$/i.test(word))) return false;
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(text)) return false;
  const titleCaseWords = words.filter((word) => /^[A-Z][a-zA-Z'.-]*$/.test(word) || /^[A-Z]\.?$/.test(word));
  return titleCaseWords.length >= Math.ceil(words.length / 2);
}

const CV_SKILL_CATALOG = [
  "typescript", "javascript", "python", "java", "sql", "ms sql", "mysql", "postgresql",
  "windows", "linux", "unix", "protractor", "selenium", "cypress", "playwright",
  "jira", "git", "jenkins", "agile", "scrum", "waterfall", "stlc", "sdlc",
  "html", "css", "react", "angular", "node.js", "aws", "azure", "docker",
  "rest", "api", "postman", "manual testing", "automation testing",
];

function skillsFromCvText(text: string): string[] {
  const lower = ` ${String(text || "").toLowerCase()} `;
  const found: string[] = [];
  for (const skill of CV_SKILL_CATALOG) {
    const needle = skill.replace(".", "\\.");
    if (new RegExp(`[^a-z0-9]${needle}[^a-z0-9]`, "i").test(lower) && !found.includes(skill)) {
      found.push(skill);
    }
  }
  return found;
}

function labeledCvValue(text: string, labels: string[]): string {
  const joined = labels.map((label) => label.replace(/\s+/g, "\\s*")).join("|");
  const match = text.match(new RegExp(`(?:^|[\\n\\r])\\s*(?:${joined})\\s*[:|#]\\s*([^\\n\\r]{2,80})`, "i"));
  return match?.[1]?.trim() || "";
}

function corpPoolProfileFromCv(file: string, text: string): {
  name: string;
  designation: string;
  email: string;
  employeeId: string;
} {
  const base = file.replace(/\.[^/.]+$/, "");
  const designationFromFile =
    base.match(/\b(SDET|QA|Quality\s*Analyst|Developer|Engineer|Lead|Manager|Architect|Analyst|Consultant|Tester)\b/i)?.[0] ||
    "";
  const fromFileRaw = base
    .replace(/[_-]+/g, " ")
    .replace(/\b\d+\s*(yoe|yrs?|years?)\b/gi, "")
    .replace(/\b(SDET|QA|resume|cv|curriculum vitae|infinite)\b/gi, "")
    .replace(/\b20\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const fromFile = stripLeadingEmployeeId(fromFileRaw);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labeledName = stripLeadingEmployeeId(
    labeledCvValue(text, ["name", "candidate name", "employee name"]).replace(/employee\s*id.*/i, "")
  );
  const nameFromLine = lines.slice(0, 15).find((line) => looksLikePersonName(line));
  const nameFromLineClean = nameFromLine ? stripLeadingEmployeeId(nameFromLine) : { id: "", rest: "" };
  const labeledTitle = labeledCvValue(text, ["title", "designation", "role", "position"]);
  const titleLine = lines.find(
    (line) =>
      line.length < 60 &&
      !/[|]/.test(line) &&
      /\b(SDET|engineer|developer|lead|manager|analyst|architect|tester)\b/i.test(line) &&
      !/employee\s*id|years? of|successfully|interoperability/i.test(line) &&
      !looksLikePersonName(line)
  );
  const email =
    labeledCvValue(text, ["email id", "email", "mail id", "e-mail"]) ||
    text.match(/[\w.-]+@[\w.-]+\.\w+/)?.[0] ||
    "";
  const cleanEmail = email.match(/[\w.-]+@[\w.-]+\.\w+/)?.[0] || "";
  const employeeId =
    extractEmployeeIdFromCv(text, file) ||
    labeledName.id ||
    nameFromLineClean.id ||
    fromFile.id;
  const name =
    (looksLikePersonName(labeledName.rest) ? labeledName.rest : "") ||
    nameFromLineClean.rest ||
    (looksLikePersonName(fromFile.rest) ? fromFile.rest : "") ||
    "Unknown";
  return {
    name,
    designation: labeledTitle || designationFromFile || titleLine || "Engineer",
    email: cleanEmail,
    employeeId,
  };
}

function sanitizeCorpPoolFileName(name: string): string {
  const base = String(name || "").split(/[/\\]/).pop() || "resume";
  const cleaned = base
    .replace(/\u00a0/g, " ")
    .replace(/[^\w.\- ()[\]]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .trim();
  const fallback = cleaned || "resume";
  if (fallback.length <= 180) return fallback;
  const ext = fallback.includes(".") ? fallback.slice(fallback.lastIndexOf(".")) : "";
  return `${fallback.slice(0, Math.max(1, 180 - ext.length))}${ext}`;
}

function uniqueCorpPoolFileName(name: string, used: Set<string>): string {
  const safe = sanitizeCorpPoolFileName(name);
  const lower = safe.toLowerCase();
  if (!used.has(lower)) {
    used.add(lower);
    return safe;
  }
  const extIdx = safe.lastIndexOf(".");
  const stem = extIdx >= 0 ? safe.slice(0, extIdx) : safe;
  const ext = extIdx >= 0 ? safe.slice(extIdx) : "";
  let i = 2;
  let next = `${stem}_${i}${ext}`;
  while (used.has(next.toLowerCase())) {
    i += 1;
    next = `${stem}_${i}${ext}`;
  }
  used.add(next.toLowerCase());
  return next;
}

function isJdDocumentRequirementName(name: string): boolean {
  return JD_DOCUMENT_EXT.test(String(name || ""));
}

function isMasterExcelRequirementName(name: string): boolean {
  const fileName = String(name || "");
  if (isJdDocumentRequirementName(fileName)) return false;
  return /\.xlsx|\.xls/i.test(fileName) || fileName.toLowerCase().includes(MASTER_BR_FILENAME.toLowerCase());
}

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
    if (!buffer?.length) throw new Error("Master BR workbook is empty");
    await workbook.xlsx.load(buffer as any);
    const sheet = findMasterBrSheet(workbook);
    if (!sheet || !readSheetHeaders(sheet).has(headerKey("Auto req ID"))) {
      throw new Error("Master BR workbook is missing Auto req ID headers");
    }
    return { workbook, filename: MASTER_BR_FILENAME };
  } catch {
    const template = await loadTemplateWorkbook();
    await saveMasterBrWorkbook(template, MASTER_BR_FILENAME);
    return { workbook: template, filename: MASTER_BR_FILENAME };
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
  // BR/JD ingest only writes job_descriptions. Never delete employees, tests,
  // test_questions, or test_attempts — Employee Portal data is independent.
  const merged = mergeBrRequirements(parseBrWorkbook(workbook, filename));
  const deleted = await loadDeletedRequirements();
  const upsertRows = merged.flatMap((row) => {
    const jdUuid = brIdToUuid(row.autoReqId);
    if (
      isRequirementDeleted(deleted, {
        id: jdUuid,
        brId: row.autoReqId,
        fileName: `${row.autoReqId} | ${filename}`,
        jdText: row.composedText,
      })
    ) {
      const existingIdx = localJds.findIndex((j: any) => j.id === jdUuid);
      if (
        existingIdx !== -1 &&
        !isJdDocumentRequirementName(String(localJds[existingIdx].fileName || ""))
      ) {
        localJds.splice(existingIdx, 1);
      }
      return [];
    }
    const newLocalJd = {
      id: jdUuid,
      jdText: row.composedText,
      rmEmail: row.rmEmail,
      fileName: `${row.autoReqId} | ${filename}`,
      createdAt: new Date().toISOString(),
    };
    const existingIdx = localJds.findIndex((j: any) => j.id === jdUuid);
    if (existingIdx !== -1) {
      const existingName = String(localJds[existingIdx].fileName || "");
      localJds[existingIdx] = {
        ...localJds[existingIdx],
        ...newLocalJd,
        fileName: isJdDocumentRequirementName(existingName)
          ? localJds[existingIdx].fileName
          : newLocalJd.fileName,
        createdAt: localJds[existingIdx].createdAt || newLocalJd.createdAt,
      };
    } else {
      localJds.push(newLocalJd);
    }
    return [{
      id: jdUuid,
      jd_text: newLocalJd.jdText,
      rm_email: newLocalJd.rmEmail,
      file_name: localJds.find((j: any) => j.id === jdUuid)?.fileName || newLocalJd.fileName,
      created_at: localJds.find((j: any) => j.id === jdUuid)?.createdAt || newLocalJd.createdAt,
    }];
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

  // Never delete existing Requirements here. Uploading JD 2 must not remove JD 1.
  // Deleted BRs stay gone because they are tombstoned and skipped above.
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
export async function refreshRequirements(opts?: {
  incomingBrFiles?: string[];
  incomingJdFiles?: string[];
}): Promise<{ success: boolean; processedBRs: number; convertedJDs: number }> {
  await ensureDocsStorage();

  const brFiles = await listDocFiles("BR");
  const jdFiles = await listDocFiles("JD");
  const incomingBr = new Set((opts?.incomingBrFiles || []).map((f) => f.toLowerCase()));
  const incomingJd = new Set((opts?.incomingJdFiles || []).map((f) => f.toLowerCase()));
  const deletedRequirements = await loadDeletedRequirements();

  let processedBRs = 0;
  let convertedJDs = 0;
  const restoredIncoming: Array<{
    id: string;
    jd_text: string;
    rm_email: string;
    file_name: string;
    created_at: string;
  }> = [];

  let localJds: any[] = [];
  const localJdPath = join(getUploadsRoot(), "job_descriptions.json");
  try {
    const raw = await readFile(localJdPath, "utf8");
    localJds = JSON.parse(raw);
  } catch {}
  try {
    const { data: existingJds } = await supabase
      .from("job_descriptions")
      .select("id, jd_text, rm_email, file_name, created_at");
    for (const row of existingJds || []) {
      if (!row?.id) continue;
      if (
        isRequirementDeleted(deletedRequirements, {
          id: row.id,
          fileName: row.file_name,
          jdText: row.jd_text,
        })
      ) {
        continue;
      }
      const local = {
        id: row.id,
        jdText: row.jd_text,
        rmEmail: row.rm_email,
        fileName: row.file_name,
        createdAt: row.created_at,
      };
      const existingIdx = localJds.findIndex((j: any) => j.id === row.id);
      if (existingIdx === -1) localJds.push(local);
      else if (isJdDocumentRequirementName(String(row.file_name || ""))) {
        localJds[existingIdx] = { ...localJds[existingIdx], ...local };
      }
    }
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
    const isIncoming = incomingBr.has(file.toLowerCase());
    if (!isIncoming) {
      try {
        await deleteDocFile("BR", file);
        await writeLog(
          "requirements",
          "REMOVED_EXTRA_BR_FILE",
          "success",
          `Removed leftover BR file ${file}; master is ${masterFilename}`
        );
      } catch (err: any) {
        await writeLog("requirements", "REMOVE_EXTRA_BR_FAILED", "failed", `Failed removing ${file}: ${err.message}`);
      }
      continue;
    }
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
      await deleteDocFile("BR", file);
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
      if (!jdText.trim()) {
        await writeLog("requirements", "CONVERT_JD_EMPTY", "failed", `No text extracted from JD ${file}`);
        continue;
      }

      const details = await extractJdDetails(jdText, file);
      const linkedId = autoReqIdFromLabel(
        localJds.find((j: any) => String(j.fileName || "").toLowerCase().includes(file.toLowerCase()))?.fileName
      );
      const autoReqId =
        normalizeBrId(file) ||
        (details.auto_req_id && normalizeBrId(details.auto_req_id)) ||
        linkedId ||
        (alreadyLinked ? "" : nextAutoReqId(existingIds));
      if (!autoReqId) {
        await writeLog("requirements", "CONVERT_JD_NO_ID", "failed", `Could not assign a BR ID for JD ${file}`);
        continue;
      }

      if (incomingJd.has(file.toLowerCase())) {
        await unmarkRequirementsDeleted([
          {
            id: brIdToUuid(autoReqId),
            brId: autoReqId,
            fileName: `${autoReqId} | ${file}`,
            jdText,
          },
        ]);
      } else if (
        isRequirementDeleted(deletedRequirements, {
          id: brIdToUuid(autoReqId),
          brId: autoReqId,
          fileName: `${autoReqId} | ${file}`,
          jdText,
        }) &&
        !localJds.some(
          (j: any) =>
            j.id === brIdToUuid(autoReqId) ||
            String(j.fileName || "").toLowerCase().includes(file.toLowerCase())
        )
      ) {
        continue;
      }

      const existingRow = idCol ? findRowByAutoReqId(masterSheet, idCol, autoReqId) : undefined;
      writeMappedRow(
        masterSheet,
        masterHeaders,
        jdExtractedFieldMap({ autoReqId, details, jdText }),
        existingRow
      );
      existingIds.add(autoReqId);
      convertedJDs++;
      restoredIncoming.push({
        id: brIdToUuid(autoReqId),
        jd_text: composeRequirementText(
          details.job_title || "Technical Role",
          [...new Set([...(details.skills || []), ...(details.tools || [])].filter(Boolean))].join(", "),
          jdText
        ) || jdText,
        rm_email: "admin@infinite.com",
        file_name: `${autoReqId} | ${file}`,
        created_at: new Date().toISOString(),
      });
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

  if (restoredIncoming.length) {
    const { error } = await supabase.from("job_descriptions").upsert(restoredIncoming);
    if (error) {
      await writeLog("requirements", "RESTORE_JD_ERROR", "failed", error.message);
    } else {
      processedBRs = Math.max(processedBRs, restoredIncoming.length);
      for (const row of restoredIncoming) {
        const existingIdx = localJds.findIndex((j: any) => j.id === row.id);
        const local = {
          id: row.id,
          jdText: row.jd_text,
          rmEmail: row.rm_email,
          fileName: row.file_name,
          createdAt: row.created_at,
        };
        if (existingIdx !== -1) localJds[existingIdx] = { ...localJds[existingIdx], ...local };
        else localJds.push(local);
      }
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
export async function refreshEmployees(
  activeJdId?: string,
  opts?: { incomingCorpPoolFiles?: string[] }
): Promise<{ success: boolean; loaded: number }> {
  await ensureDocsStorage();
  const incomingSet = new Set((opts?.incomingCorpPoolFiles || []).map((f) => f.toLowerCase()));
  let files = await listDocFiles("Corp Pool");
  if (incomingSet.size > 0) {
    files = files.filter((f) => incomingSet.has(f.toLowerCase()));
  }

  const expandedFiles: string[] = [];
  const fileBuffers = new Map<string, Buffer>();
  const usedZipNames = new Set<string>();
  for (const file of files) {
    if (!/\.zip$/i.test(file)) {
      expandedFiles.push(file);
      continue;
    }
    let extracted = 0;
    let skipped = 0;
    try {
      const zipBuffer = await readDocFileBuffer("Corp Pool", file);
      const zip = new AdmZip(zipBuffer);
      for (const entry of zip.getEntries()) {
        try {
          if (entry.isDirectory) continue;
          const entryName = String(entry.entryName || "").replace(/\\/g, "/");
          if (
            entryName.startsWith("__MACOSX") ||
            entryName.split("/").some((part) => part.startsWith("."))
          ) {
            skipped++;
            continue;
          }
          const baseName = entryName.split("/").pop() || "";
          if (!/\.(pdf|docx|doc|txt|csv|xlsx|xls)$/i.test(baseName)) {
            skipped++;
            continue;
          }
          let data: Buffer;
          try {
            data = entry.getData();
          } catch (entryErr: any) {
            skipped++;
            await writeLog(
              "employee",
              "UNZIP_ENTRY_FAILED",
              "failed",
              `Skipped ZIP entry ${baseName}: ${entryErr?.message || "unreadable"}`
            );
            continue;
          }
          if (!data?.length) {
            skipped++;
            continue;
          }
          const storedName = uniqueCorpPoolFileName(baseName, usedZipNames);
          try {
            await writeDocFile("Corp Pool", storedName, data);
          } catch (writeErr: any) {
            await writeLog(
              "employee",
              "UNZIP_STORE_FAILED",
              "failed",
              `Parsed ${storedName} in memory after storage failed: ${writeErr?.message || "write error"}`
            );
          }
          fileBuffers.set(storedName, data);
          expandedFiles.push(storedName);
          extracted++;
        } catch (entryErr: any) {
          skipped++;
          await writeLog(
            "employee",
            "UNZIP_ENTRY_FAILED",
            "failed",
            `Skipped ZIP entry: ${entryErr?.message || "unknown error"}`
          );
        }
      }
      await writeLog(
        "employee",
        "UNZIPPED_CORP_POOL",
        extracted > 0 ? "success" : "failed",
        extracted > 0
          ? `Extracted ${extracted} file(s) from ${file}${skipped ? ` (skipped ${skipped})` : ""}`
          : `ZIP ${file} had no resume/Excel/CSV files inside`
      );
    } catch (err: any) {
      await writeLog(
        "employee",
        "UNZIP_CORP_POOL_FAILED",
        "failed",
        `Failed reading ZIP ${file}: ${err.message}`
      );
    }
  }
  files = Array.from(new Set(expandedFiles));
  if (incomingSet.size > 0 && files.length === 0) {
    throw new Error(
      "The ZIP had no resume PDF/DOCX or employee Excel/CSV files inside. Put those files in the ZIP and upload again."
    );
  }
  
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
  
  const csvFiles = files.filter((f) => f.toLowerCase().endsWith(".csv"));
  const xlsxFiles = files.filter((f) => {
    const name = f.toLowerCase();
    return name.endsWith(".xlsx") || name.endsWith(".xls");
  });
  const cvFiles = files.filter((f) => /\.(pdf|docx|doc|txt)$/i.test(f));

  // A. Process Excel files
  for (const file of xlsxFiles) {
    try {
      const buffer = fileBuffers.get(file) || await readDocFileBuffer("Corp Pool", file);
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
          matchingSkills: matchResult.matchingSkills,
          source_file: file,
        };
        
        parsedEmployees.push(record);
        loaded++;
      }
    } catch (err: any) {
      await writeLog('employee', 'PARSE_EXCEL_FAILED', 'failed', `Error parsing xlsx employee pool ${file}: ${err.message}`);
    }
  }
  
  // B. Process CSV files
  for (const file of csvFiles) {
    try {
      const buffer = fileBuffers.get(file) || await readDocFileBuffer("Corp Pool", file);
      const rows = parseCorpPoolCsv(buffer);
      if (rows.length <= 1) continue;

      const headerRow = rows[0].map((h) => String(h || "").trim().toLowerCase().replace(/[_-]/g, " "));
      const getIdx = (names: string[]) => {
        const normalizedNames = names.map((n) => n.trim().toLowerCase().replace(/[_-]/g, " "));
        return headerRow.findIndex((h: string) => {
          if (!h) return false;
          return normalizedNames.some((name) => {
            if (name.length <= 3) return h === name;
            return h === name || h.includes(name) || name.includes(h);
          });
        });
      };

      const findColumnIdx = (namesInOrderOfPriority: string[]) => {
        for (const name of namesInOrderOfPriority) {
          const idx = getIdx([name]);
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const idIdx = findColumnIdx(["emp no", "employee id", "emp id", "employee code", "id"]);
      const nameIdx = findColumnIdx(["emp name", "employee name", "full name", "name"]);
      const deptIdx = findColumnIdx(["business unit", "sbu", "bu", "department", "dept"]);
      const skillsIdx = findColumnIdx(["detailed skills", "skills bucket", "top 3 skills", "primary skill", "skills"]);
      const statusIdx = findColumnIdx(["status", "availability"]);
      const gradeIdx = findColumnIdx(["grade", "level"]);
      const mailIdx = findColumnIdx(["official mail id", "official email", "email", "mail id", "mail"]);
      const roleIdx = findColumnIdx(["designation", "role", "position"]);

      for (let r = 1; r < rows.length; r++) {
        const cells = rows[r];
        if (!cells || cells.length === 0 || cells.every((c) => !String(c || "").trim())) continue;

        const empNo = idIdx !== -1 && cells[idIdx] ? String(cells[idIdx]).trim() : `EMP${Math.floor(1000 + Math.random() * 9000)}`;
        const empName = nameIdx !== -1 && cells[nameIdx] ? String(cells[nameIdx]).trim() : "Unknown Employee";
        const department = deptIdx !== -1 && cells[deptIdx] ? String(cells[deptIdx]).trim() : "Engineering";
        const skills = skillsIdx !== -1 && cells[skillsIdx] ? String(cells[skillsIdx]).trim() : "";
        const status = statusIdx !== -1 && cells[statusIdx] ? String(cells[statusIdx]).trim() : "Active";
        const grade = gradeIdx !== -1 && cells[gradeIdx] ? String(cells[gradeIdx]).trim() : "E1";
        const email = mailIdx !== -1 && cells[mailIdx] ? String(cells[mailIdx]).trim() : "";
        const designation = roleIdx !== -1 && cells[roleIdx] ? String(cells[roleIdx]).trim() : "Support Engineer";

        const matchResult = calculateSkillMatch(
          employeeMatchText({ skills, designation, grade }),
          jdSkills
        );

        parsedEmployees.push({
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
          matchingSkills: matchResult.matchingSkills,
          source_file: file,
        });
        loaded++;
      }
    } catch (err: any) {
      await writeLog('employee', 'PARSE_CSV_FAILED', 'failed', `Error parsing csv employee pool ${file}: ${err.message}`);
    }
  }

  for (const file of cvFiles) {
    try {
      const buffer = fileBuffers.get(file) || await readDocFileBuffer("Corp Pool", file);
      if (!buffer?.length) {
        await writeLog("employee", "PARSE_CV_EMPTY", "failed", `Corp Pool CV ${file} is empty`);
        continue;
      }
      const text = (await resumeService.extractTextFromBuffer(buffer)).trim();
      if (!text) {
        await writeLog("employee", "PARSE_CV_EMPTY", "failed", `No text extracted from Corp Pool CV ${file}`);
        continue;
      }

      const profile = corpPoolProfileFromCv(file, text);
      const matchResult = calculateSkillMatch(
        employeeMatchText({
          skills: text,
          designation: profile.designation,
          grade: "",
        }),
        jdSkills
      );
      const resumeSkills = skillsFromCvText(text);
      const employeeId =
        profile.employeeId ||
        `CV${createHash("md5").update(file.toLowerCase()).digest("hex").slice(0, 10)}`;
      parsedEmployees.push({
        employee_id: employeeId,
        full_name: profile.name,
        email: profile.email || `${employeeId}@corp-pool.local`,
        department: "Engineering",
        skills: resumeSkills.join(", "),
        grade: "",
        designation: profile.designation,
        status: "Active",
        shortlisted: false,
        score: matchResult.score,
        matchingSkills: matchResult.matchingSkills.length ? matchResult.matchingSkills : resumeSkills,
        source_file: file,
      });
      loaded++;
      await writeLog(
        "employee",
        "PARSED_CORP_POOL_CV",
        "success",
        `Added ${profile.name} to Corp Pool from ${file}`
      );
    } catch (err: any) {
      await writeLog("employee", "PARSE_CV_FAILED", "failed", `Error parsing Corp Pool CV ${file}: ${err.message}`);
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
  const incomingUpload = incomingSet.size > 0;
  const deletedPool = await loadDeletedCorpPool();
  if (incomingUpload) {
    await unmarkCorpPoolDeleted(
      uniqueParsedEmployees.map((emp) => emp.employee_id),
      uniqueParsedEmployees.map((emp) => emp.source_file || "")
    );
  } else {
    const kept = uniqueParsedEmployees.filter(
      (emp) => !isCorpPoolDeleted(deletedPool, { id: emp.employee_id, file: emp.source_file })
    );
    uniqueParsedEmployees.length = 0;
    uniqueParsedEmployees.push(...kept);
    loaded = uniqueParsedEmployees.length;
  }

  if (uniqueParsedEmployees.length === 0) {
    await writeLog(
      "employee",
      incomingUpload ? "INCOMING_CORP_POOL_EMPTY" : "SKIP_EMPTY_CORP_POOL",
      incomingUpload ? "failed" : "success",
      incomingUpload
        ? "Uploaded Corp Pool file produced 0 people; left the existing list unchanged"
        : "Skipped empty Corp Pool refresh to preserve Employee Portal roster and tests"
    );
    if (incomingUpload) {
      throw new Error(
        "The file was stored, but nobody was added to Corp Pool. Use a readable resume PDF/DOCX, an employee Excel/CSV, or a ZIP of those files."
      );
    }
    return { success: true, loaded: 0 };
  }

  const jsonPath = join(getUploadsRoot(), "employees.json");
  let existingList: EmployeeRecord[] = [];
  try {
    const persisted = await readPersistedJson("employees.json");
    if (persisted) existingList = JSON.parse(persisted) as EmployeeRecord[];
  } catch {}
  if (existingList.length === 0) {
    try {
      const raw = await readFile(jsonPath, "utf8");
      existingList = JSON.parse(raw) as EmployeeRecord[];
    } catch {}
  }
  if (!Array.isArray(existingList)) existingList = [];

  const byId = new Map<string, EmployeeRecord>();
  const byEmail = new Map<string, string>();
  for (const emp of existingList) {
    if (!emp?.employee_id) continue;
    byId.set(emp.employee_id, emp);
    const email = String(emp.email || "").trim().toLowerCase();
    if (email) byEmail.set(email, emp.employee_id);
  }

  let added = 0;
  let updated = 0;
  for (const parsed of uniqueParsedEmployees) {
    const email = String(parsed.email || "").trim().toLowerCase();
    const existingId = byId.has(parsed.employee_id)
      ? parsed.employee_id
      : email && byEmail.has(email)
        ? byEmail.get(email)
        : undefined;
    if (existingId && byId.has(existingId)) {
      const previous = byId.get(existingId)!;
      const keepId =
        isGeneratedCorpPoolId(existingId) && !isGeneratedCorpPoolId(parsed.employee_id)
          ? parsed.employee_id
          : existingId;
      if (keepId !== existingId) byId.delete(existingId);
      byId.set(keepId, {
        ...parsed,
        employee_id: keepId,
        shortlisted: previous.shortlisted,
      });
      if (email) byEmail.set(email, keepId);
      updated++;
    } else {
      byId.set(parsed.employee_id, parsed);
      if (email) byEmail.set(email, parsed.employee_id);
      added++;
    }
  }

  const finalEmployees = Array.from(byId.values());
  loaded = finalEmployees.length;

  const serialized = JSON.stringify(finalEmployees, null, 2);
  await writeFile(jsonPath, serialized, "utf8");
  await writePersistedJson("employees.json", serialized).catch((err) => {
    console.warn("Failed to persist employees.json to app-data:", err);
  });
  cacheStore.invalidate("employees");
  await writeLog(
    "employee",
    "SYNC_EMPLOYEE_POOL",
    "success",
    incomingUpload
      ? `Corp Pool now has ${loaded} people (added ${added}, updated ${updated})`
      : `Successfully loaded ${loaded} employees from /docs/Corp Pool`
  );

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
