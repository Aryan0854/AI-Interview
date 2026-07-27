import ExcelJS from "exceljs";
import { join } from "path";
import { derivePortalTestStatus, type PortalTestStatus } from "@/lib/portal-test-status";
import { readPersistedJson } from "@/lib/runtime-data";

export interface ResourcePortalEmployee {
  employee_id: string;
  full_name: string;
  role: string;
  domain: string;
  product: string;
  email: string;
  ddh: string;
  emp_status: string;
  remarks: string;
  assigned_questions: string[];
  assigned_question_count: number;
  test_id: string | null;
  test_status: PortalTestStatus | null;
  score: number | null;
  score_max?: number;
  tests: Array<{
    id: string;
    topicTitle: string;
    subjectTitle: string;
    difficulty: string;
    totalQuestions: number;
    status: string;
    score: number;
    scoreMax?: number;
    videoUrl?: string | null;
    proctoring?: {
      warningCount: number;
      violations: Array<{ type: string; timestamp: string }>;
      autoSubmitted: boolean;
    } | null;
    startedAt: string | null;
    completedAt: string | null;
  }>;
}

const MAPPING_FILE = join(process.cwd(), "Resource_Question_Mapping.xlsx");
const CREDENTIALS_FILE = join(process.cwd(), "Employee_User_Credentials.xlsx");

function normalizeEmployeeId(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function pickField(get: (key: string) => string, keys: string[]): string {
  for (const key of keys) {
    const value = get(key);
    if (value) return value;
  }
  return "";
}

function clean(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object" && "text" in value) return String((value as any).text ?? "").trim();
  if (typeof value === "object" && "result" in value) return String((value as any).result ?? "").trim();
  return String(value).trim();
}

export async function loadResourceQuestionMapping(): Promise<Omit<ResourcePortalEmployee, "test_id" | "test_status" | "score" | "tests">[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(MAPPING_FILE);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber - 1] = clean(cell.value);
  });

  const col = Object.fromEntries(headers.map((h, i) => [h, i]));
  const questionCols = Array.from({ length: 25 }, (_, i) => col[`Assigned Question ${i + 1}`]).filter(
    (idx) => idx !== undefined
  );

  const rowMap = new Map<string, Omit<ResourcePortalEmployee, "test_id" | "test_status" | "score" | "tests">>();

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const get = (key: string) => {
      const idx = col[key];
      if (idx === undefined) return "";
      return clean(row.getCell(idx + 1).value);
    };

    const employee_id = pickField(get, ["Emp ID", "Employee ID"]);
    if (!employee_id) return;

    const assigned_questions = questionCols
      .map((idx) => clean(row.getCell(idx + 1).value))
      .filter(Boolean);
    const dedupedQuestions: string[] = [];
    const seenQuestions = new Set<string>();
    for (const question of assigned_questions) {
      const key = question.trim().toLowerCase().replace(/\s+/g, " ");
      if (seenQuestions.has(key)) continue;
      seenQuestions.add(key);
      dedupedQuestions.push(question);
    }

    const entry = {
      employee_id,
      full_name: pickField(get, ["Emp Name", "Employee Name"]),
      role: pickField(get, ["Role"]),
      domain: pickField(get, ["Domain"]),
      product: pickField(get, ["Product", "Product-Updated"]),
      email: pickField(get, ["Nokia Email ID", "Email"]),
      ddh: pickField(get, ["DDH", "DDH Manager"]),
      emp_status: pickField(get, ["Emp Status"]),
      remarks: pickField(get, ["Remarks"]),
      assigned_questions: dedupedQuestions,
      assigned_question_count: dedupedQuestions.length,
    };

    const normId = normalizeEmployeeId(employee_id);
    const existing = rowMap.get(normId);
    if (!existing) {
      rowMap.set(normId, entry);
      return;
    }

    // Duplicate Emp ID in spreadsheet — keep the row with more assigned questions.
    const mergedQuestions = Array.from(
      new Set([...existing.assigned_questions, ...entry.assigned_questions])
    );
    rowMap.set(normId, {
      ...existing,
      ...entry,
      employee_id: entry.employee_id || existing.employee_id,
      full_name: entry.full_name || existing.full_name,
      role: entry.role || existing.role,
      domain: entry.domain || existing.domain,
      product: entry.product || existing.product,
      email: entry.email || existing.email,
      ddh: entry.ddh || existing.ddh,
      emp_status: entry.emp_status || existing.emp_status,
      assigned_questions: mergedQuestions,
      assigned_question_count: mergedQuestions.length,
      remarks: entry.remarks || existing.remarks,
    });
  });

  return Array.from(rowMap.values());
}

type PortalProfileRow = Omit<ResourcePortalEmployee, "test_id" | "test_status" | "score" | "tests">;

export async function loadEmployeeCredentialsRoster(): Promise<PortalProfileRow[]> {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(CREDENTIALS_FILE);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];

    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = clean(cell.value);
    });

    const col = Object.fromEntries(headers.map((h, i) => [h, i]));
    const rows: PortalProfileRow[] = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const get = (key: string) => {
        const idx = col[key];
        if (idx === undefined) return "";
        return clean(row.getCell(idx + 1).value);
      };

      const employee_id = pickField(get, ["Emp ID", "Employee ID"]);
      if (!employee_id) return;

      rows.push({
        employee_id,
        full_name: pickField(get, ["Employee Name", "Emp Name"]),
        role: pickField(get, ["Role"]),
        domain: pickField(get, ["Domain"]),
        product: pickField(get, ["Product", "Product-Updated"]),
        email: pickField(get, ["Nokia Email ID", "Email"]),
        ddh: pickField(get, ["DDH Manager", "DDH"]),
        emp_status: "",
        remarks: "",
        assigned_questions: [],
        assigned_question_count: 0,
      });
    });

    return rows;
  } catch {
    return [];
  }
}

function mergePortalProfileRow(rosterRow: PortalProfileRow, mappingRow?: PortalProfileRow): PortalProfileRow {
  if (!mappingRow) return rosterRow;

  return {
    employee_id: rosterRow.employee_id || mappingRow.employee_id,
    full_name: rosterRow.full_name || mappingRow.full_name,
    role: rosterRow.role || mappingRow.role,
    domain: rosterRow.domain || mappingRow.domain,
    product: rosterRow.product || mappingRow.product,
    email: rosterRow.email || mappingRow.email,
    ddh: rosterRow.ddh || mappingRow.ddh,
    emp_status: mappingRow.emp_status || rosterRow.emp_status,
    remarks: mappingRow.remarks || rosterRow.remarks,
    assigned_questions: mappingRow.assigned_questions,
    assigned_question_count: mappingRow.assigned_question_count,
  };
}

export async function loadEmployeeTestManifest(): Promise<Record<string, string>> {
  try {
    const raw = await readPersistedJson("employee_test_manifest.json");
    if (!raw) return {};
    const manifest = JSON.parse(raw) as Array<{ employee_id: string; test_id: string }>;
    return Object.fromEntries(manifest.map((item) => [String(item.employee_id).trim(), item.test_id]));
  } catch {
    return {};
  }
}

export function mergeResourcePortalData(
  mappingRows: PortalProfileRow[],
  allTestResults: any[],
  manifest: Record<string, string>
): ResourcePortalEmployee[] {
  return mappingRows.map((row) => {
    const empTests = allTestResults.filter(
      (test) => normalizeEmployeeId(test.employeeId) === normalizeEmployeeId(row.employee_id)
    );
    const manifestTestId = manifest[row.employee_id] ?? manifest[normalizeEmployeeId(row.employee_id)] ?? null;
    const primaryTest =
      empTests.find((test) => test.id === manifestTestId) ??
      empTests.find((test) => test.topicId === "resource-product-assessment") ??
      empTests[0] ??
      null;

    const completed = empTests.filter((test) => test.status === "completed");
    const primaryCompleted =
      completed.find((test) => test.id === primaryTest?.id) ?? completed[0] ?? null;
    const score =
      primaryCompleted && primaryCompleted.correctCount != null
        ? primaryCompleted.correctCount
        : primaryCompleted?.score ?? null;
    const scoreMax = primaryTest?.totalQuestions ?? row.assigned_question_count ?? 25;

    const answeredCount = primaryTest?.answeredCount ?? 0;
    const totalQuestions = primaryTest?.totalQuestions ?? row.assigned_question_count ?? 0;

    return {
      ...row,
      test_id: primaryTest?.id ?? manifestTestId,
      test_status: derivePortalTestStatus({
        assignedQuestionCount: row.assigned_question_count,
        testId: primaryTest?.id ?? manifestTestId,
        rawStatus: primaryTest?.status ?? null,
        answeredCount,
        totalQuestions,
        startedAt: primaryTest?.startedAt ?? null,
      }),
      score,
      score_max: scoreMax,
      tests: empTests.map((test) => ({
        id: test.id,
        topicTitle: test.topicTitle,
        subjectTitle: test.subjectTitle,
        difficulty: test.difficulty,
        totalQuestions: test.totalQuestions,
        status: test.status,
        score: test.correctCount ?? test.score,
        scoreMax: test.totalQuestions,
        videoUrl: test.videoUrl ?? null,
        proctoring: test.proctoring ?? null,
        startedAt: test.startedAt,
        completedAt: test.completedAt,
      })),
    };
  });
}

export async function buildResourcePortalEmployees(
  allTestResults: any[],
  manifest: Record<string, string>
): Promise<ResourcePortalEmployee[]> {
  const [rosterRows, mappingRows] = await Promise.all([
    loadEmployeeCredentialsRoster(),
    loadResourceQuestionMapping(),
  ]);

  const mappingById = new Map(
    mappingRows.map((row) => [normalizeEmployeeId(row.employee_id), row])
  );

  const profileRows =
    rosterRows.length > 0
      ? rosterRows.map((row) => mergePortalProfileRow(row, mappingById.get(normalizeEmployeeId(row.employee_id))))
      : mappingRows;

  if (rosterRows.length > 0) {
    const rosterIds = new Set(rosterRows.map((row) => normalizeEmployeeId(row.employee_id)));
    for (const row of mappingRows) {
      if (!rosterIds.has(normalizeEmployeeId(row.employee_id))) {
        profileRows.push(row);
      }
    }
  }

  return mergeResourcePortalData(profileRows, allTestResults, manifest);
}
