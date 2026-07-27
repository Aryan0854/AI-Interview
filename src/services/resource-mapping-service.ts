import ExcelJS from "exceljs";
import { join } from "path";
import { readFile } from "fs/promises";
import { derivePortalTestStatus, type PortalTestStatus } from "@/lib/portal-test-status";

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
  tests: Array<{
    id: string;
    topicTitle: string;
    subjectTitle: string;
    difficulty: string;
    totalQuestions: number;
    status: string;
    score: number;
    startedAt: string | null;
    completedAt: string | null;
  }>;
}

const MAPPING_FILE = join(process.cwd(), "Resource_Question_Mapping.xlsx");

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

    const employee_id = get("Emp ID");
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
      full_name: get("Emp Name"),
      role: get("Role"),
      domain: get("Domain"),
      product: get("Product"),
      email: get("Nokia Email ID"),
      ddh: get("DDH"),
      emp_status: get("Emp Status"),
      remarks: get("Remarks"),
      assigned_questions: dedupedQuestions,
      assigned_question_count: dedupedQuestions.length,
    };

    const normId = employee_id.trim();
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
      assigned_questions: mergedQuestions,
      assigned_question_count: mergedQuestions.length,
      remarks: entry.remarks || existing.remarks,
    });
  });

  return Array.from(rowMap.values());
}

export async function loadEmployeeTestManifest(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(process.cwd(), "uploads", "employee_test_manifest.json"), "utf8");
    const manifest = JSON.parse(raw) as Array<{ employee_id: string; test_id: string }>;
    return Object.fromEntries(manifest.map((item) => [String(item.employee_id).trim(), item.test_id]));
  } catch {
    return {};
  }
}

export function mergeResourcePortalData(
  mappingRows: Omit<ResourcePortalEmployee, "test_id" | "test_status" | "score" | "tests">[],
  allTestResults: any[],
  manifest: Record<string, string>
): ResourcePortalEmployee[] {
  return mappingRows.map((row) => {
    const empTests = allTestResults.filter(
      (test) => String(test.employeeId).trim() === String(row.employee_id).trim()
    );
    const manifestTestId = manifest[row.employee_id] ?? null;
    const primaryTest =
      empTests.find((test) => test.id === manifestTestId) ??
      empTests.find((test) => test.topicId === "resource-product-assessment") ??
      empTests[0] ??
      null;

    const completed = empTests.filter((test) => test.status === "completed");
    const avgScore =
      completed.length > 0
        ? Math.round(completed.reduce((sum, test) => sum + (test.score || 0), 0) / completed.length)
        : null;

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
      score: avgScore,
      tests: empTests.map((test) => ({
        id: test.id,
        topicTitle: test.topicTitle,
        subjectTitle: test.subjectTitle,
        difficulty: test.difficulty,
        totalQuestions: test.totalQuestions,
        status: test.status,
        score: test.score,
        startedAt: test.startedAt,
        completedAt: test.completedAt,
      })),
    };
  });
}
