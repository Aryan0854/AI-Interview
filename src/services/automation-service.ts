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

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

export interface EmployeeRecord {
  employee_id: string;
  full_name: string;
  email: string;
  department: string;
  skills: string;
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
 * Helper to calculate skill match score based on keyword overlap
 */
export function calculateSkillMatch(employeeSkills: string, jdSkills: string): { score: number; matchingSkills: string[] } {
  if (!employeeSkills || !jdSkills) {
    return { score: 0, matchingSkills: [] };
  }

  // Common technical skills catalog
  const COMMON_TECH_SKILLS = [
    // Languages
    "javascript", "typescript", "python", "java", "c++", "c#", "c", "ruby", "golang", "php", "rust", "swift", "kotlin", "perl", "r", "scala",
    // Web / Frontend / Backend
    "react", "angular", "vue", "next.js", "nextjs", "nuxt", "node.js", "nodejs", "express", "django", "flask", "spring", "springboot", "asp.net", "laravel", "rails",
    // Databases / Data Store
    "sql", "postgresql", "postgres", "oracle", "mysql", "sql server", "sqlite", "mongodb", "mongo", "redis", "cassandra", "dynamodb", "mariadb", "couchdb", "neo4j",
    // Cloud / DevOps
    "aws", "amazon web services", "azure", "gcp", "google cloud", "docker", "kubernetes", "k8s", "jenkins", "ansible", "terraform", "ci/cd", "cicd", "git", "github", "gitlab",
    // System / OS / Admin
    "linux", "windows", "unix", "ubuntu", "centos", "redhat", "red hat", "debian", "macos", "shell", "bash", "powershell",
    // Monitoring / Logging / Tools
    "splunk", "datadog", "dynatrace", "appdynamics", "new relic", "prometheus", "grafana", "elk", "elasticsearch", "logstash", "kibana", "service now", "servicenow", "jira", "confluence",
    // QA / Testing / Tools
    "manual testing", "manual", "automation", "selenium", "postman", "jmeter", "cucumber", "testing",
    // Architecture / Concepts
    "microservices", "api", "apis", "rest", "graphql", "soap", "kafka", "rabbitmq", "mq", "activemq", "architecture", "architect", "estimation", "rca", "incident management", "problem management", "change management"
  ];

  const extractSkills = (text: string) => {
    const lower = text.toLowerCase();
    const found = new Set<string>();
    for (const skill of COMMON_TECH_SKILLS) {
      const escaped = skill.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`(^|[^a-zA-Z0-9_#+])(${escaped})([^a-zA-Z0-9_#+]|$)`, 'i');
      if (regex.test(lower)) {
        // Normalize synonyms
        if (skill === "postgres") found.add("postgresql");
        else if (skill === "nodejs") found.add("node.js");
        else if (skill === "nextjs") found.add("next.js");
        else if (skill === "amazon web services") found.add("aws");
        else if (skill === "google cloud") found.add("gcp");
        else if (skill === "servicenow") found.add("service now");
        else if (skill === "red hat") found.add("redhat");
        else if (skill === "apis") found.add("api");
        else found.add(skill);
      }
    }
    return Array.from(found);
  };

  const empSkills = extractSkills(employeeSkills);
  const jdSkillsList = extractSkills(jdSkills);

  if (empSkills.length === 0 || jdSkillsList.length === 0) {
    // Fallback to basic word boundary matching if no standard keywords found
    const STOP_WORDS = new Set(["to", "and", "the", "for", "in", "of", "on", "with", "at", "by", "from", "an", "is", "as", "end", "be", "or", "exp", "year", "years", "total", "skills", "basics", "basic", "etc", "ex", "eg"]);
    const cleanSkills = (str: string) => {
      return str.toLowerCase()
        .split(/[,;+\n/|]/)
        .map(s => s.trim())
        .flatMap(s => {
          if (s === "end-to-end" || s === "ci-cd" || s === "ci/cd") return [s];
          return s.split(/\s*-\s*/); // Split on hyphens with surrounding spaces (like "api - postman")
        })
        .map(s => s.trim())
        .filter(s => s.length > 1 && !STOP_WORDS.has(s));
    };
    
    const empSkillsList = cleanSkills(employeeSkills);
    if (empSkillsList.length === 0) {
      return { score: 0, matchingSkills: [] };
    }
    
    const lowercaseJd = jdSkills.toLowerCase();
    const matchingSkills: string[] = [];
    
    for (const empSkill of empSkillsList) {
      const skillLower = empSkill.toLowerCase();
      const escaped = skillLower.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`(^|[^a-zA-Z0-9_#+])(${escaped})([^a-zA-Z0-9_#+]|$)`, 'i');
      if (regex.test(lowercaseJd)) {
        matchingSkills.push(empSkill);
      }
    }
    const uniqueMatches = Array.from(new Set(matchingSkills));
    const score = Math.min(100, Math.round((uniqueMatches.length / empSkillsList.length) * 100));
    
    // Map matches back to pretty uppercase format
    const prettyMatches = uniqueMatches.map(s => {
      return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    });
    
    return { score, matchingSkills: prettyMatches };
  }

  // Intersection of keywords
  const matchingSkills = empSkills.filter(skill => jdSkillsList.includes(skill));
  
  // Calculate a match score based on how many of the JD required skills the employee has. Capped at a divisor of 8.
  const divisor = Math.min(8, jdSkillsList.length);
  const score = Math.min(100, Math.round((matchingSkills.length / divisor) * 100));

  // Map normalized skills back to their pretty counterparts
  const prettyMatches = matchingSkills.map(s => {
    return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  });

  return {
    score,
    matchingSkills: prettyMatches
  };
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
  
  // Scenario A & C: Process available BR Excel files directly from docs/BR
  for (const file of xlsxBrFiles) {
    try {
      const workbook = new ExcelJS.Workbook();
      const buffer = await readDocFileBuffer("BR", file);
      await workbook.xlsx.load(buffer as any);
      
      const sheet = workbook.getWorksheet("BR _Raw Data") || workbook.worksheets[0];
      const sheetData: any[][] = [];
      sheet.eachRow((row) => {
        sheetData.push(row.values as any[]);
      });
      
      if (sheetData.length <= 0) continue;
      
      // Dynamically find the header row
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(10, sheetData.length); i++) {
        const r = sheetData[i];
        if (Array.isArray(r)) {
          const hasHeaders = r.some(h => {
            if (!h) return false;
            const str = String(h).trim().toLowerCase();
            return str.includes("auto req id") || str.includes("br id") || str.includes("designation") || str.includes("job title");
          });
          if (hasHeaders) {
            headerRowIdx = i;
            break;
          }
        }
      }
      
      if (headerRowIdx === -1) {
        headerRowIdx = 0;
      }
      
      const headerRow = sheetData[headerRowIdx] || [];
      const getColIndex = (names: string[]) => {
        const normalizedNames = names.map(n => n.trim().toLowerCase().replace(/[_-]/g, ' '));
        return headerRow.findIndex((h: any) => {
          if (!h) return false;
          const normalizedH = String(h).trim().toLowerCase().replace(/[_-]/g, ' ');
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
      const titleIdx = findColIdx(["designation", "job title", "role", "position"]);
      const skillsIdx = findColIdx(["mandatory skills", "skills", "detailed skills"]);
      const jdIdx = findColIdx(["job description", "jd"]);
      const rmIdx = findColIdx(["rm name", "reporting manager"]);
      
      for (let r = headerRowIdx + 1; r < sheetData.length; r++) {
        const row = sheetData[r];
        if (!row) continue;
        
        const autoReqId = idIdx !== -1 && row[idIdx] ? String(row[idIdx]).trim() : "";
        if (!autoReqId) continue;
        
        const designation = titleIdx !== -1 && row[titleIdx] ? String(row[titleIdx]).trim() : "Technical Role";
        let skills = skillsIdx !== -1 && row[skillsIdx] ? String(row[skillsIdx]).trim() : "";
        let jdText = jdIdx !== -1 && row[jdIdx] ? String(row[jdIdx]).trim() : "";
        const rmEmail = rmIdx !== -1 && row[rmIdx] ? String(row[rmIdx]).trim() : "admin@infinite.com";

        // Dynamic fallback heuristic for shifted/misaligned spreadsheet rows:
        const looksLikeJd = (text: string) => {
          const lower = text.toLowerCase();
          return text.length > 150 && (
            lower.includes("responsibilities") ||
            lower.includes("experience") ||
            lower.includes("skills") ||
            lower.includes("troubleshooting") ||
            lower.includes("qualification") ||
            lower.includes("support")
          );
        };
        
        const looksLikeSkills = (text: string) => {
          const commaCount = (text.match(/,/g) || []).length;
          const lower = text.toLowerCase();
          return commaCount >= 2 && (
            lower.includes("sql") ||
            lower.includes("unix") ||
            lower.includes("linux") ||
            lower.includes("java") ||
            lower.includes("python") ||
            lower.includes("aws") ||
            lower.includes("azure")
          );
        };

        // Scan all cells in the row for a better candidate if needed
        for (let idx = 1; idx < row.length; idx++) {
          const val = row[idx];
          if (val && typeof val === "string") {
            const trimmed = val.trim();
            if (looksLikeJd(trimmed)) {
              jdText = trimmed;
            } else if (looksLikeSkills(trimmed) && trimmed.length > skills.length) {
              skills = trimmed;
            }
          }
        }
        
        const jdUuid = brIdToUuid(autoReqId);
        const jdTextContent = jdText || skills;
        const newLocalJd = {
          id: jdUuid,
          jdText: jdTextContent,
          rmEmail: rmEmail.includes("@") ? rmEmail : "admin@infinite.com",
          fileName: `${autoReqId} | ${file}`,
          createdAt: new Date().toISOString()
        };
        const existingIdx = localJds.findIndex((j: any) => j.id === jdUuid);
        if (existingIdx !== -1) {
          localJds[existingIdx] = newLocalJd;
        } else {
          localJds.push(newLocalJd);
        }

        let dbError: any = null;
        try {
          const { error } = await supabase.from('job_descriptions').upsert({
            id: jdUuid,
            jd_text: jdTextContent,
            rm_email: newLocalJd.rmEmail,
            file_name: newLocalJd.fileName,
            created_at: newLocalJd.createdAt
          });
          dbError = error;
        } catch (e) {
          dbError = e;
        }
        
        if (dbError) {
          await writeLog('requirements', 'UPSERT_BR_ERROR', 'failed', `Error saving BR ${autoReqId}: ${dbError.message || dbError}`);
        } else {
          processedBRs++;
          await writeLog('requirements', 'PARSED_BR_ROW', 'success', `Successfully loaded BR ID: ${autoReqId} (UUID: ${jdUuid}) from ${file}`);
        }
      }
    } catch (err: any) {
      await writeLog('requirements', 'PARSE_BR_FILE_FAILED', 'failed', `Failed parsing BR file ${file}: ${err.message}`);
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
    await writeFile(localJdPath, JSON.stringify(localJds, null, 2), "utf8");
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
  
  // Save enriched records
  await writeFile(jsonPath, JSON.stringify(finalEmployees, null, 2), "utf8");
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
