import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { supabase } from "@/lib/db";
import { localTestsDb, LocalTestsDb } from "@/services/local-tests-db";
import { allowLocalTestsFallback, useSupabasePrimary } from "@/lib/db-mode";
import {
  buildResourcePortalEmployees,
  loadEmployeeTestManifest,
} from "@/services/resource-mapping-service";
import {
  formatAttemptResult,
  formatQuestionAnswerBlock,
  formatSubmittedAt,
  getTestQuestionAttemptsBatch,
} from "@/services/employee-test-attempts-service";
import { getPortalTestStatusLabel } from "@/lib/portal-test-status";
import { formatTopicTitleForDisplay, formatProductDisplayName } from "@/lib/product-display-name";

export const runtime = "nodejs";
export const maxDuration = 300;

function formatPortalScore(score: number | null | undefined, scoreMax = 25): string {
  if (score === null || score === undefined) return "—";
  return `${score}/${scoreMax}`;
}

function formatExportCompletedAt(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function loadAllTestResults(): Promise<any[]> {
  const allTestResults: any[] = [];

  try {
    const { data: viewRows, error: viewError } = await supabase
      .from("employee_test_results")
      .select("*");

    if (viewError) {
      const { data: dbTests, error: dbTestsError } = await supabase.from("tests").select("*");
      if (dbTestsError) throw dbTestsError;

      const { data: employeeRows } = await supabase
        .from("employees")
        .select("id, employee_id, full_name");
      const employeeUuidMap = new Map<string, { employee_id: string; full_name: string }>();
      (employeeRows ?? []).forEach((row) => {
        if (row.id) employeeUuidMap.set(row.id, row);
      });

      (dbTests ?? []).forEach((test) => {
        const linked = employeeUuidMap.get(String(test.employee_id ?? ""));
        const empId = (test as any).employee_code || linked?.employee_id;
        if (!empId) return;

        const totalQs = (test as any).score_total ?? test.total_questions ?? 25;
        const score = (test as any).score_correct ?? 0;
        const scorePercent =
          (test as any).score_percent ??
          (totalQs > 0 ? Math.round((score / totalQs) * 100) : 0);

        allTestResults.push({
          id: test.id,
          employeeId: empId,
          employeeName: linked?.full_name || empId,
          topicId: test.topic_id,
          topicTitle: (test as any).topic_title || "Unknown Topic",
          subjectId: test.subject_id,
          subjectTitle: (test as any).subject_title || "Unknown Subject",
          difficulty: test.difficulty,
          totalQuestions: totalQs,
          status: test.status,
          answeredCount: 0,
          correctCount: score,
          score,
          scorePercent,
          videoUrl: (test as any).session_recording_url || null,
          proctoring: (test as any).proctoring || null,
          startedAt: test.started_at,
          completedAt: test.completed_at,
        });
      });
    } else {
      (viewRows ?? []).forEach((row: any) => {
        const empId = row.employee_code;
        if (!empId) return;

        const totalQs = row.score_total ?? row.total_questions ?? 25;
        const score = row.score_correct ?? 0;
        const scorePercent =
          row.score_percent ??
          (totalQs > 0 ? Math.round((score / totalQs) * 100) : 0);

        allTestResults.push({
          id: row.test_id,
          employeeId: empId,
          employeeName: row.employee_name || empId,
          topicId: row.topic_id,
          topicTitle: row.topic_title || "Unknown Topic",
          subjectId: row.subject_id,
          subjectTitle: row.subject_title || "Unknown Subject",
          difficulty: "medium",
          totalQuestions: totalQs,
          status: row.status,
          answeredCount: row.answers_submitted ?? 0,
          correctCount: score,
          score,
          scorePercent,
          videoUrl: row.video_url || null,
          proctoring: row.proctoring || null,
          startedAt: row.started_at,
          completedAt: row.completed_at,
        });
      });
    }
  } catch (err) {
    console.error("Export portal: failed to load Supabase test results:", err);
  }

  if (!useSupabasePrimary() && allowLocalTestsFallback()) {
    try {
      const localTests = await localTestsDb.loadDB().catch(() => null);
      if (localTests) {
        const localAttempts = localTests.test_attempts || [];
        localTests.tests.forEach((test) => {
          const empId = test.employee_id;
          if (!empId) return;

          const testAttempts = localAttempts.filter((a) => a.test_id === test.id);
          const correctCount = LocalTestsDb.scoreFromAttempts(testAttempts, test);
          const totalQs = test.total_questions ?? 25;
          const scorePercent =
            test.score_percent ??
            (totalQs > 0 ? Math.round((correctCount / totalQs) * 100) : 0);

          const existingIdx = allTestResults.findIndex((t) => t.id === test.id);
          const row = {
            id: test.id,
            employeeId: empId,
            employeeName: empId,
            topicId: test.topic_id,
            topicTitle: test.topic_title || "Unknown Topic",
            subjectId: test.subject_id,
            subjectTitle: test.subject_title || "Unknown Subject",
            difficulty: test.difficulty,
            totalQuestions: totalQs,
            status: test.status,
            answeredCount: testAttempts.length,
            correctCount,
            score: correctCount,
            scorePercent,
            videoUrl: test.session_recording_url || null,
            proctoring: test.proctoring || null,
            startedAt: test.started_at,
            completedAt: test.completed_at,
          };

          if (existingIdx >= 0) {
            allTestResults[existingIdx] = { ...allTestResults[existingIdx], ...row };
          } else {
            allTestResults.push(row);
          }
        });
      }
    } catch (err) {
      console.warn("Export portal: local tests overlay failed:", err);
    }
  }

  return allTestResults.map((test) => ({
    ...test,
    topicTitle: formatTopicTitleForDisplay(test.topicTitle),
  }));
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4F46E5" },
  };
  row.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  row.height = 25;
}

function applyDataBorders(worksheet: ExcelJS.Worksheet) {
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 1) return;
    row.eachCell((cell) => {
      cell.alignment = {
        vertical: "top",
        horizontal: "left",
        wrapText: true,
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
  });
}

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const manifest = await loadEmployeeTestManifest();
    const allTestResults = await loadAllTestResults();
    const resourcePortalEmployees = await buildResourcePortalEmployees(allTestResults, manifest);

    const workbook = new ExcelJS.Workbook();

    const summarySheet = workbook.addWorksheet("Employee Portal Results");
    const summaryHeaders = [
      "Employee Name",
      "Employee ID",
      "Role",
      "Domain",
      "Product",
      "Email",
      "DDH",
      "Test Status",
      "Completed On",
      "Score",
      "Remarks",
      "Assigned Questions & Answers",
    ];

    summarySheet.columns = summaryHeaders.map((header) => ({
      header,
      key: header,
      width:
        header === "Email"
          ? 28
          : header === "Assigned Questions & Answers"
            ? 80
            : header === "Employee Name"
              ? 25
              : header === "Remarks"
                ? 30
                : 16,
    }));
    styleHeaderRow(summarySheet.getRow(1));

    const detailSheet = workbook.addWorksheet("Question Details");
    const detailHeaders = [
      "Employee ID",
      "Employee Name",
      "Question #",
      "Question",
      "Selected Answer",
      "Result",
      "Submitted At",
    ];
    detailSheet.columns = detailHeaders.map((header) => ({
      header,
      key: header,
      width: header === "Question" ? 60 : header === "Selected Answer" ? 40 : 18,
    }));
    styleHeaderRow(detailSheet.getRow(1));

    const completedTestIds = resourcePortalEmployees
      .filter((account) => account.test_id && account.test_status === "completed")
      .map((account) => account.test_id as string);
    const attemptsByTestId = await getTestQuestionAttemptsBatch(completedTestIds);

    for (const account of resourcePortalEmployees) {
      const employeeName = account.full_name || account.employee_id;
      const scoreMax = account.score_max ?? account.assigned_question_count ?? 25;
      const questionAttempts =
        account.test_id && account.test_status === "completed"
          ? attemptsByTestId.get(account.test_id) ?? null
          : null;

      const answerBlock =
        questionAttempts && questionAttempts.length > 0
          ? formatQuestionAnswerBlock(questionAttempts)
          : account.assigned_questions?.length
            ? [
                `Assigned Questions (${account.assigned_question_count})`,
                ...account.assigned_questions,
              ].join("\n")
            : "";

      summarySheet.addRow([
        employeeName,
        account.employee_id,
        account.role || "—",
        account.domain || "—",
        formatProductDisplayName(account.product) || "—",
        account.email || "—",
        account.ddh || "—",
        getPortalTestStatusLabel(account.test_status),
        formatExportCompletedAt(account.completed_at),
        account.score !== null && account.score !== undefined
          ? formatPortalScore(account.score, scoreMax)
          : "—",
        account.remarks?.trim() ? account.remarks : "—",
        answerBlock,
      ]);

      if (questionAttempts && questionAttempts.length > 0) {
        for (const q of questionAttempts) {
          detailSheet.addRow([
            account.employee_id,
            employeeName,
            q.question_index + 1,
            q.question_text,
            q.selected_option_text || "Not answered",
            q.selected_option_text ? formatAttemptResult(q.is_correct) || "—" : "—",
            q.submitted_at ? formatSubmittedAt(q.submitted_at) : "—",
          ]);
        }
      } else {
        (account.assigned_questions || []).forEach((questionText, idx) => {
          detailSheet.addRow([
            account.employee_id,
            employeeName,
            idx + 1,
            questionText,
            "—",
            "—",
            "—",
          ]);
        });
      }
    }

    applyDataBorders(summarySheet);
    applyDataBorders(detailSheet);

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `employee_portal_test_results_${new Date().toISOString().split("T")[0]}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Export failed";
    console.error("Portal export failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
