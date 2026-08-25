import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { authenticateAdminRequest } from "@/lib/employee-auth";

export const runtime = "nodejs";

type ShortlistedExportRow = {
  employee_id?: string;
  full_name?: string;
  email?: string;
  designation?: string;
  department?: string;
  grade?: string;
  skills?: string;
  score?: number;
  matchDecision?: string;
  matchingSkills?: string[];
  status?: string;
};

function cell(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (value == null) return "";
  return String(value).trim();
}

export async function POST(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const rows = (Array.isArray(body.employees) ? body.employees : []) as ShortlistedExportRow[];
    const shortlisted = rows.filter((row) => String(row.employee_id || "").trim());

    if (!shortlisted.length) {
      return NextResponse.json(
        { error: "Shortlist at least one Corp Pool person before exporting." },
        { status: 400 }
      );
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "HR Screening Console";
    const sheet = workbook.addWorksheet("Shortlisted Interviews");
    sheet.columns = [
      { header: "Name", key: "name", width: 28 },
      { header: "Employee ID", key: "employeeId", width: 14 },
      { header: "Email", key: "email", width: 28 },
      { header: "Designation", key: "designation", width: 26 },
      { header: "Department", key: "department", width: 18 },
      { header: "Grade", key: "grade", width: 10 },
      { header: "Match Score", key: "score", width: 14 },
      { header: "Decision", key: "decision", width: 12 },
      { header: "Matching Skills", key: "matching", width: 36 },
      { header: "Skills", key: "skills", width: 42 },
      { header: "Status", key: "status", width: 12 },
    ];

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4C1D95" } };
    header.alignment = { vertical: "middle" };

    for (const emp of shortlisted) {
      sheet.addRow({
        name: cell(emp.full_name),
        employeeId: cell(emp.employee_id),
        email: cell(emp.email),
        designation: cell(emp.designation),
        department: cell(emp.department),
        grade: cell(emp.grade),
        score: Number.isFinite(Number(emp.score)) ? `${Math.round(Number(emp.score))}%` : "",
        decision: cell(emp.matchDecision).toUpperCase(),
        matching: cell(emp.matchingSkills),
        skills: cell(emp.skills),
        status: cell(emp.status) || "Shortlisted",
      });
    }

    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `corp_pool_shortlisted_${new Date().toISOString().split("T")[0]}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Export failed";
    console.error("Shortlisted interview export failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
