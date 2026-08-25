import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { refreshEmployees, EmployeeRecord, calculateSkillMatch } from '@/services/automation-service';
import { supabase } from '@/lib/db';
import { writeLog } from '@/lib/structured-logger';
import { localTestsDb, LocalTestsDb } from '@/services/local-tests-db';
import { allowLocalTestsFallback, allowLocalDataFallback, useSupabasePrimary } from '@/lib/db-mode';
import { formatProductDisplayName, formatTopicTitleForDisplay } from '@/lib/product-display-name';
import { normalizeProctoring } from '@/lib/employee-proctoring';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

const getEmployeesJsonPath = () => {
  return join(getUploadsRoot(), "employees.json");
};

import { cacheStore } from '@/lib/cache-store';
import {
  buildResourcePortalEmployees,
  loadEmployeeTestManifest,
} from '@/services/resource-mapping-service';

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const activeJdId = searchParams.get('activeJdId') || undefined;
  const isExport = searchParams.get('export') === 'true';

  const cached = cacheStore.get("employees", 5000, activeJdId);
  if (cached && !isExport) {
    return NextResponse.json(cached);
  }

  const jsonPath = getEmployeesJsonPath();
  let employees: EmployeeRecord[] = [];

  try {
    const raw = await readFile(jsonPath, "utf8");
    const parsed = JSON.parse(raw) as EmployeeRecord[];
    const seen = new Set<string>();
    employees = parsed.filter(emp => {
      if (!emp.employee_id) return true;
      if (seen.has(emp.employee_id)) return false;
      seen.add(emp.employee_id);
      return true;
    });
  } catch (e: any) {
    if (e.code === "ENOENT") {
      const res = await refreshEmployees(activeJdId);
      try {
        const raw = await readFile(jsonPath, "utf8");
        employees = JSON.parse(raw);
      } catch (e2) {
        employees = [];
      }
    }
  }

  // If activeJdId is provided, dynamically re-calculate match scores against it
  if (activeJdId && activeJdId !== 'all' && employees.length > 0) {
    try {
      const { data: dbJd } = await supabase
        .from('job_descriptions')
        .select('jd_text')
        .eq('id', activeJdId)
        .single();
      
      if (dbJd && dbJd.jd_text) {
        employees = employees.map(emp => {
          const matchResult = calculateSkillMatch(emp.skills || '', dbJd.jd_text);
          return {
            ...emp,
            score: matchResult.score,
            matchingSkills: matchResult.matchingSkills
          };
        });
      }
    } catch (dbErr) {
      console.error("Failed to query JD or recalculate employee skill match:", dbErr);
    }
  }

  // Query MCQ test results from Supabase (production source of truth)
  const testResultsMap = new Map<string, { status: string; score: number; completedAt: string | null }[]>();
  const allTestResults: any[] = [];

  try {
    const { data: viewRows, error: viewError } = await supabase
      .from("employee_test_results")
      .select("*");

    if (viewError) {
      // View may not exist on older schemas — fall back to tests table
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
          employeeUuid: test.employee_id,
          employeeId: empId,
          employeeName: linked?.full_name || empId,
          topicId: test.topic_id,
          topicTitle: formatTopicTitleForDisplay((test as any).topic_title) || "Assigned Questions",
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
          proctoring: normalizeProctoring((test as any).proctoring),
          startedAt: test.started_at,
          completedAt: test.completed_at,
        });

        const list = testResultsMap.get(empId) || [];
        list.push({ status: test.status, score: scorePercent, completedAt: test.completed_at });
        testResultsMap.set(empId, list);
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
          employeeUuid: null,
          employeeId: empId,
          employeeName: row.employee_name || empId,
          topicId: row.topic_id,
          topicTitle: formatTopicTitleForDisplay(row.topic_title) || "Assigned Questions",
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
          proctoring: normalizeProctoring(row.proctoring),
          startedAt: row.started_at,
          completedAt: row.completed_at,
        });

        const list = testResultsMap.get(empId) || [];
        list.push({ status: row.status, score: scorePercent, completedAt: row.completed_at });
        testResultsMap.set(empId, list);
      });
    }
  } catch (err) {
    console.error("Failed to fetch test results from Supabase:", err);
  }

  // Dev-only: overlay local JSON when not running Supabase-primary
  if (!useSupabasePrimary() && allowLocalTestsFallback()) {
  try {
    const localTests = await localTestsDb.loadDB().catch(() => null);
    if (localTests) {
      const localAttempts = localTests.test_attempts || [];

      localTests.tests.forEach(test => {
        const empId = test.employee_id;
        if (!empId) return;

        const testAttempts = localAttempts.filter((a) => a.test_id === test.id);
        const answeredCount = testAttempts.length;
        const correctCount = LocalTestsDb.scoreFromAttempts(testAttempts, test);
        const totalQs = test.total_questions ?? 25;
        const score = correctCount;
        const scorePercent =
          test.score_percent ??
          (totalQs > 0 ? Math.round((correctCount / totalQs) * 100) : 0);

        const existingIdx = allTestResults.findIndex((t) => t.id === test.id);
        if (existingIdx >= 0) {
          allTestResults[existingIdx] = {
            ...allTestResults[existingIdx],
            status: test.status,
            answeredCount,
            correctCount,
            score,
            scorePercent,
            videoUrl: test.session_recording_url || allTestResults[existingIdx].videoUrl || null,
            proctoring: test.proctoring != null ? normalizeProctoring(test.proctoring) : allTestResults[existingIdx].proctoring ?? null,
            completedAt: test.completed_at,
          };
        } else {
          const matchingEmp = employees.find(e => e.employee_id === empId);
          allTestResults.push({
            id: test.id,
            employeeUuid: empId,
            employeeId: empId,
            employeeName: matchingEmp?.full_name || empId,
            topicId: test.topic_id,
            topicTitle: formatTopicTitleForDisplay(test.topic_title) || "Assigned Questions",
            subjectId: test.subject_id,
            subjectTitle: test.subject_title || "Unknown Subject",
            difficulty: test.difficulty,
            totalQuestions: totalQs,
            status: test.status,
            answeredCount,
            correctCount,
            score,
            scorePercent,
            videoUrl: test.session_recording_url || null,
            proctoring: normalizeProctoring(test.proctoring),
            startedAt: test.started_at,
            completedAt: test.completed_at
          });
        }

        const list = testResultsMap.get(empId) || [];
        if (!list.some(t => t.completedAt === test.completed_at && test.status === "completed")) {
          list.push({
            status: test.status,
            score: scorePercent,
            completedAt: test.completed_at
          });
          testResultsMap.set(empId, list);
        }
      });
    }
  } catch (err) {
    console.warn("Failed to fetch test results from local DB:", err);
  }
  }

  // Attach testResults to employees
  employees = employees.map(emp => {
    return {
      ...emp,
      testResults: testResultsMap.get(emp.employee_id) || []
    };
  });

  // Handle Export to CSV
  if (isExport) {
    const headers = ["Employee ID", "Name", "Department", "Designation", "Skills", "Status", "Grade", "Match Score", "Shortlisted"];
    const rows = [headers];
    
    employees.forEach(emp => {
      rows.push([
        emp.employee_id,
        emp.full_name,
        emp.department,
        emp.designation,
        emp.skills,
        emp.status,
        emp.grade,
        String(emp.score),
        emp.shortlisted ? "Yes" : "No"
      ]);
    });

    const csvContent = rows.map(r => r.map(c => {
      let str = String(c).trim();
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        str = '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }).join(',')).join('\n');

    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="employee_pool.csv"'
      }
    });
  }

  if (!isExport) {
    let resourcePortalEmployees: any[] = [];
    try {
      const manifest = await loadEmployeeTestManifest();
      resourcePortalEmployees = await buildResourcePortalEmployees(allTestResults, manifest);
      const liveProductById = new Map(
        employees
          .filter((emp) => emp.employee_id && emp.skills)
          .map((emp) => [
            String(emp.employee_id).trim().toUpperCase(),
            String(emp.skills).trim(),
          ])
      );
      if (liveProductById.size > 0) {
        resourcePortalEmployees = resourcePortalEmployees.map((row) => {
          const liveProduct = liveProductById.get(
            String(row.employee_id || "").trim().toUpperCase()
          );
          if (!liveProduct) return row;
          return { ...row, product: formatProductDisplayName(liveProduct) };
        });
      }
    } catch (mappingErr) {
      console.warn("Failed to load employee portal mapping:", mappingErr);
    }

    cacheStore.set("employees", { employees, allTestResults, resourcePortalEmployees }, activeJdId);
    return NextResponse.json({ employees, allTestResults, resourcePortalEmployees });
  }

  return NextResponse.json({ employees, allTestResults });
}

export async function POST(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let employeeId: any = null;
  try {
    const body = await request.json().catch(() => ({}));
    employeeId = body.employeeId;
    if (!employeeId) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
    }

    const jsonPath = getEmployeesJsonPath();
    let employees: EmployeeRecord[] = [];
    try {
      const raw = await readFile(jsonPath, "utf8");
      const parsed = JSON.parse(raw) as EmployeeRecord[];
      const seen = new Set<string>();
      employees = parsed.filter(emp => {
        if (!emp.employee_id) return true;
        if (seen.has(emp.employee_id)) return false;
        seen.add(emp.employee_id);
        return true;
      });
    } catch (e) {
      return NextResponse.json({ error: "Employees not loaded" }, { status: 404 });
    }

    const matched = employees.find(e => e.employee_id === employeeId);
    if (!matched) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    // Toggle shortlisted state
    matched.shortlisted = !matched.shortlisted;
    await writeFile(jsonPath, JSON.stringify(employees, null, 2), "utf8");
    cacheStore.invalidate("employees");

    await writeLog('employee', 'SHORTLIST_EMPLOYEE', 'success', `Toggled shortlist for employee ID ${employeeId}: shortlisted=${matched.shortlisted}`);

    return NextResponse.json({ success: true, employee: matched });
  } catch (error: any) {
    await writeLog('employee', 'SHORTLIST_EMPLOYEE_FAILED', 'failed', `Failed to toggle shortlist for employee ID ${employeeId || 'unknown'}: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let targetIds: string[] = [];
  try {
    const body = await request.json().catch(() => ({}));
    const employeeId = body.employeeId;
    const ids = body.ids as string[] | undefined;

    if (!employeeId && (!ids || ids.length === 0)) {
      return NextResponse.json({ error: "Employee ID or IDs array is required" }, { status: 400 });
    }

    targetIds = ids || [employeeId];

    const jsonPath = getEmployeesJsonPath();
    let employees: EmployeeRecord[] = [];
    try {
      const raw = await readFile(jsonPath, "utf8");
      const parsed = JSON.parse(raw) as EmployeeRecord[];
      employees = parsed.filter(emp => !targetIds.includes(emp.employee_id));
      await writeFile(jsonPath, JSON.stringify(employees, null, 2), "utf8");
      cacheStore.invalidate("employees");
    } catch (e) {
      return NextResponse.json({ error: "Employees not loaded" }, { status: 404 });
    }

    // Also delete from Supabase employees table
    const { error: dbError } = await supabase
      .from('employees')
      .delete()
      .in('employee_id', targetIds);

    if (dbError) {
      console.warn("Failed to delete employees from Supabase:", dbError.message);
    }

    await writeLog('employee', 'DELETE_EMPLOYEE', 'success', `Deleted employee IDs: ${targetIds.join(', ')}`);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    await writeLog('employee', 'DELETE_EMPLOYEE_FAILED', 'failed', `Failed to delete employees: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
