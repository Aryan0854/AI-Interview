import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { refreshEmployees, EmployeeRecord, calculateSkillMatch } from '@/services/automation-service';
import { supabase } from '@/lib/db';
import { writeLog } from '@/lib/structured-logger';
import { localTestsDb } from '@/services/local-tests-db';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

const getEmployeesJsonPath = () => {
  return join(getUploadsRoot(), "employees.json");
};

import { cacheStore } from '@/lib/cache-store';

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

  // Fetch every registered learning-portal employee account from Supabase.
  // This is independent of test activity — a newly signed-up employee with
  // zero test attempts must still show up in the admin Employee Portal tab.
  let registeredAccounts: {
    employee_id: string;
    full_name: string;
    email: string | null;
    department: string | null;
    role: string | null;
    created_at: string | null;
  }[] = [];

  try {
    const { data: dbEmployees, error: employeesErr } = await supabase
      .from("employees")
      .select("employee_id, full_name, email, department, role, created_at");

    if (employeesErr) throw employeesErr;
    registeredAccounts = dbEmployees || [];
  } catch (err) {
    console.warn("Failed to fetch registered employee accounts from Supabase:", err);
  }

  // Query MCQ test results for each employee
  const testResultsMap = new Map<string, { status: string; score: number; completedAt: string | null }[]>();
  const allTestResults: any[] = [];

  try {
    const { data: dbTests } = await supabase
      .from("tests")
      .select(`
        id,
        employee_id,
        topic_id,
        subject_id,
        difficulty,
        total_questions,
        status,
        started_at,
        completed_at,
        employees (
          employee_id,
          full_name
        ),
        learning_topics (
          title
        ),
        learning_subjects (
          title
        )
      `);

    const { data: dbAttempts } = await supabase
      .from("test_attempts")
      .select("test_id, is_correct");

    const attemptsMap = new Map<string, { correct: number; total: number }>();
    if (dbAttempts) {
      dbAttempts.forEach(att => {
        const current = attemptsMap.get(att.test_id) || { correct: 0, total: 0 };
        current.total += 1;
        if (att.is_correct) current.correct += 1;
        attemptsMap.set(att.test_id, current);
      });
    }

    if (dbTests) {
      dbTests.forEach(test => {
        const empInfo = test.employees as any;
        const empId = empInfo?.employee_id;
        if (!empId) return;

        const attInfo = attemptsMap.get(test.id);
        const score = attInfo && attInfo.total > 0 ? Math.round((attInfo.correct / attInfo.total) * 100) : 0;

        const list = testResultsMap.get(empId) || [];
        list.push({
          status: test.status,
          score,
          completedAt: test.completed_at
        });
        testResultsMap.set(empId, list);

        const topicInfo = test.learning_topics as any;
        const subjectInfo = test.learning_subjects as any;

        allTestResults.push({
          id: test.id,
          employeeUuid: test.employee_id,
          employeeId: empId,
          employeeName: empInfo?.full_name || empId,
          topicId: test.topic_id,
          topicTitle: topicInfo?.title || "Unknown Topic",
          subjectId: test.subject_id,
          subjectTitle: subjectInfo?.title || "Unknown Subject",
          difficulty: test.difficulty,
          totalQuestions: test.total_questions,
          status: test.status,
          score,
          startedAt: test.started_at,
          completedAt: test.completed_at
        });
      });
    }
  } catch (err) {
    console.warn("Failed to fetch test results from Supabase:", err);
  }

  try {
    const localTests = await localTestsDb.loadDB().catch(() => null);
    if (localTests) {
      const localAttempts = localTests.test_attempts || [];
      const localAttemptsMap = new Map<string, { correct: number; total: number }>();
      localAttempts.forEach(att => {
        const current = localAttemptsMap.get(att.test_id) || { correct: 0, total: 0 };
        current.total += 1;
        if (att.is_correct) current.correct += 1;
        localAttemptsMap.set(att.test_id, current);
      });

      localTests.tests.forEach(test => {
        const empId = test.employee_id;
        if (!empId) return;

        const attInfo = localAttemptsMap.get(test.id);
        const score = attInfo && attInfo.total > 0 ? Math.round((attInfo.correct / attInfo.total) * 100) : 0;

        const list = testResultsMap.get(empId) || [];
        if (!list.some(t => t.completedAt === test.completed_at)) {
          list.push({
            status: test.status,
            score,
            completedAt: test.completed_at
          });
          testResultsMap.set(empId, list);
        }

        if (!allTestResults.some(t => t.id === test.id)) {
          const matchingEmp = employees.find(e => e.employee_id === empId);
          allTestResults.push({
            id: test.id,
            employeeUuid: empId,
            employeeId: empId,
            employeeName: matchingEmp?.full_name || empId,
            topicId: test.topic_id,
            topicTitle: test.topic_title || "Unknown Topic",
            subjectId: test.subject_id,
            subjectTitle: test.subject_title || "Unknown Subject",
            difficulty: test.difficulty,
            totalQuestions: test.total_questions,
            status: test.status,
            score,
            startedAt: test.started_at,
            completedAt: test.completed_at
          });
        }
      });
    }
  } catch (err) {
    console.warn("Failed to fetch test results from local DB:", err);
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
    cacheStore.set("employees", { employees, allTestResults, registeredAccounts }, activeJdId);
  }

  return NextResponse.json({ employees, allTestResults, registeredAccounts });
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
