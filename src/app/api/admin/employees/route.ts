import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { refreshEmployees, EmployeeRecord, calculateSkillMatch } from '@/services/automation-service';
import { supabase } from '@/lib/db';
import { writeLog } from '@/lib/structured-logger';
import { localTestsDb, LocalTestsDb } from '@/services/local-tests-db';
import { allowLocalTestsFallback, allowLocalDataFallback } from '@/lib/db-mode';
import { formatTopicTitleForDisplay } from '@/lib/product-display-name';

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
import { normalizeProctoring } from '@/lib/employee-proctoring';
import { listEmployeeTestRecordingIds } from '@/lib/employee-test-video';

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const activeJdId = searchParams.get('activeJdId') || undefined;
  const isExport = searchParams.get('export') === 'true';
  const skipCache = searchParams.get('fresh') === '1';

  const cached = !skipCache && cacheStore.get("employees", 120000, activeJdId);
  if (cached && !isExport) {
    // Never trust a cached payload that lost live test results while roster still has assignments.
    const cachedResults = Array.isArray(cached.allTestResults) ? cached.allTestResults.length : 0;
    const cachedPortal = Array.isArray(cached.resourcePortalEmployees)
      ? cached.resourcePortalEmployees
      : [];
    const assignedWithoutLive =
      cachedPortal.filter((e: any) => e?.test_id || (e?.assigned_question_count ?? 0) > 0).length > 0 &&
      cachedResults === 0;
    if (!assignedWithoutLive) {
      return NextResponse.json(cached);
    }
  }

  const jsonPath = getEmployeesJsonPath();

  const loadEmployeesFromFile = async (): Promise<EmployeeRecord[]> => {
    try {
      const raw = await readFile(jsonPath, "utf8");
      const parsed = JSON.parse(raw) as EmployeeRecord[];
      const seen = new Set<string>();
      return parsed.filter((emp) => {
        if (!emp.employee_id) return true;
        if (seen.has(emp.employee_id)) return false;
        seen.add(emp.employee_id);
        return true;
      });
    } catch (e: any) {
      if (e.code === "ENOENT") {
        await refreshEmployees(activeJdId);
        try {
          const raw = await readFile(jsonPath, "utf8");
          return JSON.parse(raw);
        } catch {
          return [];
        }
      }
      return [];
    }
  };

  /** Full roster from Supabase — never drop DB rows just because local /tmp JSON is incomplete. */
  const loadEmployeesFromSupabase = async (): Promise<EmployeeRecord[]> => {
    try {
      const pageSize = 1000;
      let from = 0;
      const rows: EmployeeRecord[] = [];
      while (true) {
        const { data, error } = await supabase
          .from("employees")
          .select(
            "employee_id, email, full_name, department, role, ai_readiness_score, product"
          )
          .order("employee_id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data?.length) break;
        for (const row of data) {
          if (!row.employee_id) continue;
          rows.push({
            employee_id: String(row.employee_id),
            full_name: row.full_name || String(row.employee_id),
            email: row.email || "",
            department: row.department || "",
            skills: row.product ? String(row.product) : "",
            grade: "",
            designation: row.role || "employee",
            status: "Active",
            shortlisted: false,
            score: typeof row.ai_readiness_score === "number" ? row.ai_readiness_score : 0,
            matchingSkills: [],
          });
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return rows;
    } catch (err) {
      console.warn("Failed to load employees from Supabase:", err);
      return [];
    }
  };

  const mergeEmployeeRosters = (primary: EmployeeRecord[], secondary: EmployeeRecord[]) => {
    const byId = new Map<string, EmployeeRecord>();
    for (const emp of secondary) {
      const key = String(emp.employee_id || "").trim().toUpperCase();
      if (!key) continue;
      byId.set(key, emp);
    }
    // Primary (usually Corp Pool JSON) wins on overlapping fields so screening skills stay intact.
    for (const emp of primary) {
      const key = String(emp.employee_id || "").trim().toUpperCase();
      if (!key) continue;
      const prev = byId.get(key);
      byId.set(key, prev ? { ...prev, ...emp, skills: emp.skills || prev.skills } : emp);
    }
    return Array.from(byId.values());
  };

  const [employeesFromFile, employeesFromDb, manifest] = await Promise.all([
    allowLocalDataFallback() ? loadEmployeesFromFile() : Promise.resolve([] as EmployeeRecord[]),
    loadEmployeesFromSupabase(),
    loadEmployeeTestManifest(),
  ]);

  // Supabase roster is source of truth; local JSON only fills gaps when fallback is allowed.
  let employees =
    employeesFromDb.length > 0
      ? mergeEmployeeRosters(employeesFromDb, employeesFromFile)
      : employeesFromFile;

  if (employeesFromDb.length === 0 && employeesFromFile.length > 0 && !allowLocalDataFallback()) {
    console.warn(
      "[employees] Supabase returned 0 rows and local JSON fallback is disabled (ALLOW_LOCAL_DATA_FALLBACK)."
    );
  } else if (employeesFromDb.length === 0 && employeesFromFile.length === 0) {
    console.warn("[employees] No employees from Supabase or local sources.");
  }

  // Query MCQ test results from Supabase (production source of truth),
  // with a hard timeout so a slow DB cannot block the portal indefinitely.
  const testResultsMap = new Map<string, { status: string; score: number; completedAt: string | null }[]>();
  const allTestResults: any[] = [];

  const applyJdSkillMatch = async () => {
    if (!activeJdId || activeJdId === "all" || employees.length === 0) return;
    try {
      const { data: dbJd } = await supabase
        .from("job_descriptions")
        .select("jd_text")
        .eq("id", activeJdId)
        .single();

      if (dbJd?.jd_text) {
        employees = employees.map((emp) => {
          const matchResult = calculateSkillMatch(emp.skills || "", dbJd.jd_text);
          return {
            ...emp,
            score: matchResult.score,
            matchingSkills: matchResult.matchingSkills,
          };
        });
      }
    } catch (dbErr) {
      console.error("Failed to query JD or recalculate employee skill match:", dbErr);
    }
  };

  const resolveEmployeeCode = (code: unknown, name: unknown): string | null => {
    const fromCode = String(code ?? "").trim();
    if (fromCode) return fromCode;
    // Some completed rows store the numeric emp id in employee_name when employee_code is null.
    const fromName = String(name ?? "").trim();
    if (/^\d{4,}$/.test(fromName)) return fromName;
    return null;
  };

  const pushResultRow = (row: {
    id: string;
    employeeUuid: string | null;
    employeeId: string;
    employeeName: string;
    topicId: string | null;
    topicTitle: string;
    subjectId: string | null;
    subjectTitle: string;
    difficulty: string;
    totalQuestions: number;
    status: string;
    answeredCount: number;
    correctCount: number;
    score: number;
    scorePercent: number;
    videoUrl: string | null;
    proctoring: ReturnType<typeof normalizeProctoring>;
    startedAt: string | null;
    completedAt: string | null;
  }) => {
    allTestResults.push(row);
    const list = testResultsMap.get(row.employeeId) || [];
    list.push({
      status: row.status,
      score: row.scorePercent,
      completedAt: row.completedAt,
    });
    testResultsMap.set(row.employeeId, list);
  };

  const loadFromTestsTable = async () => {
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
      const empId = resolveEmployeeCode(
        (test as any).employee_code || linked?.employee_id,
        linked?.full_name
      );
      if (!empId) return;

      const totalQs = (test as any).score_total ?? test.total_questions ?? 25;
      const score = (test as any).score_correct ?? (test as any).answers_correct ?? 0;
      const scorePercent =
        (test as any).score_percent ??
        (totalQs > 0 ? Math.round((score / totalQs) * 100) : 0);

      pushResultRow({
        id: test.id,
        employeeUuid: test.employee_id,
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
        proctoring: normalizeProctoring((test as any).proctoring),
        startedAt: test.started_at,
        completedAt: test.completed_at,
      });
    });
  };

  const loadSupabaseResults = async () => {
  try {
    // Paginate — default PostgREST page size can truncate large result sets.
    const pageSize = 1000;
    let from = 0;
    const viewRows: any[] = [];
    let viewError: { message?: string } | null = null;

    while (true) {
      const { data, error } = await supabase
        .from("employee_test_results")
        .select("*")
        .range(from, from + pageSize - 1);
      if (error) {
        viewError = error;
        break;
      }
      if (!data?.length) break;
      viewRows.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    if (viewError) {
      // View may not exist on older schemas — fall back to tests table
      await loadFromTestsTable();
    } else {
      viewRows.forEach((row: any) => {
        const empId = resolveEmployeeCode(row.employee_code, row.employee_name);
        if (!empId) return;

        const totalQs = row.score_total ?? row.total_questions ?? 25;
        const score = row.score_correct ?? row.answers_correct ?? 0;
        const scorePercent =
          row.score_percent ??
          (totalQs > 0 ? Math.round((score / totalQs) * 100) : 0);

        pushResultRow({
          id: row.test_id,
          employeeUuid: null,
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
          proctoring: normalizeProctoring(row.proctoring),
          startedAt: row.started_at,
          completedAt: row.completed_at,
        });
      });

      // View returned rows we couldn't map (null employee_code) or was empty — use tests table.
      if (allTestResults.length === 0) {
        await loadFromTestsTable();
      }
    }
  } catch (err) {
    console.error("Failed to fetch test results from Supabase:", err);
  }
  };

  await applyJdSkillMatch();

  // Always await Supabase results. A short race previously returned the portal
  // with an empty result set on slow cold starts, making every test look "Not Started".
  try {
    await Promise.race([
      loadSupabaseResults(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("supabase_results_timeout")), 50_000)
      ),
    ]);
  } catch (err) {
    console.warn("Supabase employee test results load timed out or failed:", err);
  }

  // Overlay / fill from local JSON when allowed (also used as prod fallback if Supabase timed out)
  if (allowLocalTestsFallback() || allTestResults.length === 0) {
  try {
    const localTests = await localTestsDb.loadDB().catch(() => null);
    if (localTests) {
      const attemptsByTest = new Map<string, any[]>();
      for (const attempt of localTests.test_attempts || []) {
        const list = attemptsByTest.get(attempt.test_id) || [];
        list.push(attempt);
        attemptsByTest.set(attempt.test_id, list);
      }

      const employeesById = new Map(
        employees
          .filter((e) => e.employee_id)
          .map((e) => [String(e.employee_id).trim().toUpperCase(), e])
      );
      const resultIndexById = new Map(allTestResults.map((t, idx) => [t.id, idx]));

      localTests.tests.forEach((test) => {
        const empId = test.employee_code || test.employee_id;
        if (!empId) return;

        const testAttempts = attemptsByTest.get(test.id) || [];
        const answeredCount = testAttempts.length;
        const correctCount = LocalTestsDb.scoreFromAttempts(testAttempts, test);
        const totalQs = test.total_questions ?? 25;
        const score = correctCount;
        const scorePercent =
          test.score_percent ??
          (totalQs > 0 ? Math.round((correctCount / totalQs) * 100) : 0);

        const existingIdx = resultIndexById.get(test.id);
        if (existingIdx !== undefined) {
          const existing = allTestResults[existingIdx];
          // Never downgrade a completed Supabase result to a stale local pending row.
          const keepCompleted =
            existing.status === "completed" && test.status !== "completed";
          allTestResults[existingIdx] = {
            ...existing,
            status: keepCompleted ? existing.status : test.status,
            answeredCount: keepCompleted ? existing.answeredCount : answeredCount,
            correctCount: keepCompleted ? existing.correctCount : correctCount,
            score: keepCompleted ? existing.score : score,
            scorePercent: keepCompleted ? existing.scorePercent : scorePercent,
            videoUrl: test.session_recording_url || existing.videoUrl || null,
            proctoring: normalizeProctoring(test.proctoring ?? existing.proctoring),
            startedAt: keepCompleted ? existing.startedAt : test.started_at,
            completedAt: keepCompleted ? existing.completedAt : test.completed_at,
          };
        } else {
          const matchingEmp = employeesById.get(String(empId).trim().toUpperCase());
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
          resultIndexById.set(test.id, allTestResults.length - 1);
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

  const recordingIds = await listEmployeeTestRecordingIds();
  for (let i = 0; i < allTestResults.length; i++) {
    allTestResults[i] = {
      ...allTestResults[i],
      topicTitle: formatTopicTitleForDisplay(allTestResults[i].topicTitle),
      hasRecording: recordingIds.has(String(allTestResults[i].id ?? "")),
    };
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
      resourcePortalEmployees = await buildResourcePortalEmployees(allTestResults, manifest);
    } catch (mappingErr) {
      console.warn("Failed to load employee portal mapping:", mappingErr);
    }

    const payload = { employees, allTestResults, resourcePortalEmployees };
    const blankLiveResults =
      allTestResults.length === 0 &&
      resourcePortalEmployees.some((e: any) => e?.test_id || (e?.assigned_question_count ?? 0) > 0);
    if (!blankLiveResults) {
      cacheStore.set("employees", payload, activeJdId);
    } else {
      cacheStore.invalidate("employees");
    }

    return NextResponse.json(payload);
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
