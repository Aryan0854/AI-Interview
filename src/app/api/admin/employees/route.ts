import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { EmployeeRecord } from '@/services/automation-service';
import { supabase } from '@/lib/db';
import { writeLog } from '@/lib/structured-logger';
import { localTestsDb, LocalTestsDb } from '@/services/local-tests-db';
import { allowLocalTestsFallback } from '@/lib/db-mode';
import { formatProductDisplayName, formatTopicTitleForDisplay } from '@/lib/product-display-name';
import { readPersistedJson, writePersistedJson, getRuntimeUploadsRoot } from '@/lib/runtime-data';
import { calculateSkillMatch, employeeMatchText } from '@/lib/skill-match';
import { cacheStore } from '@/lib/cache-store';
import { deleteDocFile, listDocFiles } from '@/lib/docs-storage';
import { isCorpPoolDeleted, loadDeletedCorpPool, markCorpPoolDeleted } from '@/lib/deleted-corp-pool';
import { getAdminAccess } from '@/lib/admin-accounts-server';
import {
  buildResourcePortalEmployees,
  loadEmployeeTestManifest,
} from '@/services/resource-mapping-service';
import { normalizeProctoring } from '@/lib/employee-proctoring';
import { listEmployeeTestRecordingIds } from '@/lib/employee-test-video';
import { displayEmployeeCode, isEmployeeUuid, normalizeEmployeeId } from '@/lib/employee-test-access';

const getUploadsRoot = () => getRuntimeUploadsRoot();

const getEmployeesJsonPath = () => {
  return join(getUploadsRoot(), "employees.json");
};

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
  const requesterEmail = searchParams.get('email')?.trim().toLowerCase() || "";
  const access = requesterEmail ? await getAdminAccess(requesterEmail) : null;
  const hidePortal = access ? !access.canViewEmployeePortal : false;

  const withPortalVisibility = (payload: {
    employees: unknown;
    allTestResults: unknown;
    resourcePortalEmployees: unknown;
  }) => {
    if (!hidePortal) return payload;
    return {
      ...payload,
      allTestResults: [],
      resourcePortalEmployees: [],
    };
  };

  const cached = !skipCache && cacheStore.get("employees", 8000, activeJdId);
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
      return NextResponse.json(withPortalVisibility(cached));
    }
  }

  const jsonPath = getEmployeesJsonPath();

  const loadEmployeesFromFile = async (): Promise<EmployeeRecord[]> => {
    const parseList = (raw: string): EmployeeRecord[] => {
      const parsed = JSON.parse(raw) as EmployeeRecord[];
      const seen = new Set<string>();
      return (Array.isArray(parsed) ? parsed : []).filter((emp) => {
        if (!emp.employee_id) return true;
        if (seen.has(emp.employee_id)) return false;
        seen.add(emp.employee_id);
        return true;
      });
    };

    try {
      const persisted = await readPersistedJson("employees.json");
      if (persisted) return parseList(persisted);
    } catch (err) {
      console.warn("[employees] persisted employees.json read failed:", err);
    }

    try {
      const raw = await readFile(jsonPath, "utf8");
      return parseList(raw);
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return [];
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
          const product = row.product ? String(row.product) : "";
          const designation = row.role && row.role !== "employee" ? String(row.role) : "";
          rows.push({
            employee_id: String(row.employee_id),
            full_name: row.full_name || String(row.employee_id),
            email: row.email || "",
            department: row.department || "",
            skills: "",
            product,
            grade: "",
            designation: designation || row.role || "employee",
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

  const [employeesFromFile, employeesFromDb, manifest] = await Promise.all([
    loadEmployeesFromFile(),
    loadEmployeesFromSupabase(),
    loadEmployeeTestManifest(),
  ]);

  // Corp Pool is screening-only. Employee Portal accounts/tests must never appear here.
  const deletedPool = await loadDeletedCorpPool();
  let employees = employeesFromFile.filter(
    (emp) => !isCorpPoolDeleted(deletedPool, { id: emp.employee_id, file: emp.source_file })
  );

  // Query MCQ test results from Supabase (production source of truth),
  // with a hard timeout so a slow DB cannot block the portal indefinitely.
  const testResultsMap = new Map<string, { status: string; score: number; completedAt: string | null }[]>();
  const allTestResults: any[] = [];

  const applyJdSkillMatch = async () => {
    if (!activeJdId || activeJdId === "all" || employees.length === 0) return;
    try {
      let jdText = "";
      const { data: dbJd } = await supabase
        .from("job_descriptions")
        .select("jd_text")
        .eq("id", activeJdId)
        .maybeSingle();
      if (dbJd?.jd_text) {
        jdText = dbJd.jd_text;
      } else {
        const { data: latestJd } = await supabase
          .from("job_descriptions")
          .select("jd_text")
          .order("created_at", { ascending: false })
          .limit(1);
        jdText = latestJd?.[0]?.jd_text || "";
      }
      if (!jdText.trim()) return;

      employees = employees.map((emp) => {
        const matchResult = calculateSkillMatch(employeeMatchText(emp), jdText);
        return {
          ...emp,
          score: typeof emp.score_override === "number" ? emp.score_override : matchResult.score,
          matchingSkills: matchResult.matchingSkills,
        };
      });
    } catch (dbErr) {
      console.error("Failed to query JD or recalculate employee skill match:", dbErr);
    }
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

  const TEST_LIST_COLUMNS =
    "id, employee_id, employee_code, status, topic_id, subject_id, difficulty, total_questions, score_correct, score_total, score_percent, session_recording_url, proctoring, started_at, completed_at, topic_title, subject_title";

  const VIEW_LIST_COLUMNS =
    "test_id, employee_code, employee_name, topic_id, topic_title, subject_id, subject_title, status, score_total, total_questions, score_correct, score_percent, answers_submitted, video_url, proctoring, started_at, completed_at";

  const loadEmployeeUuidMap = async () => {
    const employeeUuidMap = new Map<string, { employee_id: string; full_name: string }>();
    try {
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("employees")
          .select("id, employee_id, full_name")
          .range(from, from + pageSize - 1);
        if (error) {
          console.warn("[employees] uuid map load failed:", error.message);
          break;
        }
        if (!data?.length) break;
        for (const row of data) {
          if (row.id) employeeUuidMap.set(row.id, row);
          const code = normalizeEmployeeId(row.employee_id);
          if (code) employeeUuidMap.set(code, row);
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
    } catch (err) {
      console.warn("[employees] uuid map exception:", err);
    }
    return employeeUuidMap;
  };

  const loadFromTestsTable = async () => {
    const pageSize = 500;
    let from = 0;
    const dbTests: any[] = [];

    while (true) {
      const { data, error } = await supabase
        .from("tests")
        .select(TEST_LIST_COLUMNS)
        .order("completed_at", { ascending: false, nullsFirst: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data?.length) break;
      dbTests.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    const employeeUuidMap = await loadEmployeeUuidMap();

    for (const test of dbTests) {
      const owner = String(test.employee_id ?? "");
      const linked = employeeUuidMap.get(owner) || employeeUuidMap.get(normalizeEmployeeId(test.employee_code));
      const empId = displayEmployeeCode({
        employeeCode: test.employee_code,
        employeeId: test.employee_id,
        linkedCode: linked?.employee_id,
        linkedName: linked?.full_name,
      });
      if (!empId || isEmployeeUuid(empId)) continue;

      const totalQs = test.score_total ?? test.total_questions ?? 25;
      const score = test.score_correct ?? 0;
      const scorePercent =
        test.score_percent ??
        (totalQs > 0 ? Math.round((score / totalQs) * 100) : 0);

      pushResultRow({
        id: test.id,
        employeeUuid: isEmployeeUuid(owner) ? owner : linked ? owner : null,
        employeeId: empId,
        employeeName: linked?.full_name || empId,
        topicId: test.topic_id,
        topicTitle: test.topic_title || "Unknown Topic",
        subjectId: test.subject_id,
        subjectTitle: test.subject_title || "Unknown Subject",
        difficulty: test.difficulty || "medium",
        totalQuestions: totalQs,
        status: test.status,
        answeredCount: 0,
        correctCount: score,
        score,
        scorePercent,
        videoUrl: test.session_recording_url || null,
        proctoring: normalizeProctoring(test.proctoring),
        startedAt: test.started_at,
        completedAt: test.completed_at,
      });
    }
  };

  const loadFromResultsView = async (): Promise<boolean> => {
    const pageSize = 500;
    let from = 0;
    const viewRows: any[] = [];

    while (true) {
      const { data, error } = await supabase
        .from("employee_test_results")
        .select(VIEW_LIST_COLUMNS)
        .order("completed_at", { ascending: false, nullsFirst: false })
        .range(from, from + pageSize - 1);
      if (error) {
        console.warn("[employees] employee_test_results view unavailable:", error.message);
        return false;
      }
      if (!data?.length) break;
      viewRows.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    for (const row of viewRows) {
      const empId = displayEmployeeCode({
        employeeCode: row.employee_code,
        linkedName: row.employee_name,
      });
      if (!empId || isEmployeeUuid(empId)) continue;

      const totalQs = row.score_total ?? row.total_questions ?? 25;
      const score = row.score_correct ?? 0;
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
    }
    return true;
  };

  const loadSupabaseResults = async () => {
    // Prefer lean `tests` table first (reliable on Vercel). Fall back to view, then retry tests.
    try {
      await loadFromTestsTable();
      if (allTestResults.length > 0) {
        console.info(`[employees] Loaded ${allTestResults.length} test results from tests table`);
        return;
      }
    } catch (err: any) {
      console.error(
        "Failed to fetch test results from tests table:",
        err?.message || err,
        err?.cause?.message || ""
      );
    }

    try {
      const ok = await loadFromResultsView();
      if (ok && allTestResults.length > 0) {
        console.info(`[employees] Loaded ${allTestResults.length} test results from employee_test_results`);
        return;
      }
    } catch (err: any) {
      console.error(
        "Failed to fetch test results from Supabase view:",
        err?.message || err,
        err?.cause?.message || ""
      );
    }

    // Last retry — transient network/abort on first attempt
    try {
      await loadFromTestsTable();
      console.info(`[employees] Retry loaded ${allTestResults.length} test results from tests table`);
    } catch (err: any) {
      console.error(
        "Failed to fetch test results from Supabase:",
        err?.message || err,
        err?.cause?.message || ""
      );
    }
  };

  await applyJdSkillMatch();

  // Await fully — do not race-abort; empty results make every portal row look "Not Started".
  await loadSupabaseResults();


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
        const empId = displayEmployeeCode({
          employeeCode: test.employee_code,
          employeeId: test.employee_id,
        });
        if (!empId || isEmployeeUuid(empId)) return;
        const matchingEmp = employeesById.get(String(empId).trim().toUpperCase());

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
      const liveProductById = new Map(
        employeesFromDb
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

    const payload = { employees, allTestResults, resourcePortalEmployees };
    const blankLiveResults =
      allTestResults.length === 0 &&
      resourcePortalEmployees.some((e: any) => e?.test_id || (e?.assigned_question_count ?? 0) > 0);
    if (!blankLiveResults) {
      cacheStore.set("employees", payload, activeJdId);
    } else {
      cacheStore.invalidate("employees");
    }

    return NextResponse.json(withPortalVisibility(payload));
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
      const changeList = Array.isArray(body.changes)
        ? body.changes
            .map((row: any) => ({
              employeeId: String(row?.employeeId || "").trim(),
              shortlisted: typeof row?.shortlisted === "boolean" ? row.shortlisted : null,
            }))
            .filter((row: { employeeId: string; shortlisted: boolean | null }) => row.employeeId && row.shortlisted !== null)
        : [];
      const requestedIds = Array.isArray(body.employeeIds)
        ? body.employeeIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
        : [];
      employeeId = body.employeeId;
      if (employeeId) requestedIds.push(String(employeeId).trim());
      for (const row of changeList) requestedIds.push(row.employeeId);
      const uniqueIds = Array.from(new Set(requestedIds.filter(Boolean)));
      if (uniqueIds.length === 0) {
        return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
      }

      const jsonPath = getEmployeesJsonPath();
      let employees: EmployeeRecord[] = [];
      try {
        const persisted = await readPersistedJson("employees.json");
        const raw = persisted || (await readFile(jsonPath, "utf8"));
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

      const setTo = typeof body.shortlisted === "boolean" ? body.shortlisted : null;
      const changeMap = new Map(changeList.map((row: { employeeId: string; shortlisted: boolean }) => [row.employeeId, row.shortlisted]));
      const updated: EmployeeRecord[] = [];
      for (const id of uniqueIds) {
        const matched = employees.find(e => e.employee_id === id);
        if (!matched) continue;
        if (changeMap.has(id)) {
          matched.shortlisted = Boolean(changeMap.get(id));
        } else {
          matched.shortlisted = setTo === null ? !matched.shortlisted : setTo;
        }
        updated.push(matched);
      }
      if (updated.length === 0) {
        return NextResponse.json({ error: "Employee not found" }, { status: 404 });
      }

      const serialized = JSON.stringify(employees, null, 2);
      await writeFile(jsonPath, serialized, "utf8");
      await writePersistedJson("employees.json", serialized).catch((err) => {
        console.warn("Failed to persist employees.json after shortlist:", err);
      });
      cacheStore.invalidate("employees");

      await writeLog(
        'employee',
        uniqueIds.length > 1 ? 'SHORTLIST_EMPLOYEES_BULK' : 'SHORTLIST_EMPLOYEE',
        'success',
        uniqueIds.length > 1
          ? `Set shortlist=${setTo} for ${updated.length} employee(s)`
          : `Toggled shortlist for employee ID ${uniqueIds[0]}: shortlisted=${updated[0].shortlisted}`
      );

      return NextResponse.json({
        success: true,
        employee: updated[0],
        employees: updated,
        updatedCount: updated.length,
      });
  } catch (error: any) {
    await writeLog('employee', 'SHORTLIST_EMPLOYEE_FAILED', 'failed', `Failed to toggle shortlist for employee ID ${employeeId || 'unknown'}: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let employeeId: string = "";
  try {
    const body = await request.json().catch(() => ({}));
    employeeId = String(body.employeeId || "").trim();
    const updates = (body.updates && typeof body.updates === "object") ? body.updates : {};
    if (!employeeId) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
    }

    const jsonPath = getEmployeesJsonPath();
    let employees: EmployeeRecord[] = [];
    try {
      const persisted = await readPersistedJson("employees.json");
      const raw = persisted || (await readFile(jsonPath, "utf8"));
      employees = JSON.parse(raw) as EmployeeRecord[];
    } catch {
      return NextResponse.json({ error: "Employees not loaded" }, { status: 404 });
    }
    if (!Array.isArray(employees)) {
      return NextResponse.json({ error: "Employees not loaded" }, { status: 404 });
    }

    const matched = employees.find((emp) => emp.employee_id === employeeId);
    if (!matched) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const nextId = String(updates.employee_id ?? matched.employee_id).trim();
    if (!nextId) {
      return NextResponse.json({ error: "Employee ID cannot be empty." }, { status: 400 });
    }
    if (nextId !== employeeId && employees.some((emp) => emp.employee_id === nextId)) {
      return NextResponse.json({ error: `Employee ID ${nextId} already exists.` }, { status: 409 });
    }

    const stringFields: Array<keyof EmployeeRecord> = [
      "full_name",
      "email",
      "department",
      "skills",
      "designation",
      "grade",
      "status",
      "product",
    ];
    for (const field of stringFields) {
      if (updates[field] !== undefined) {
        (matched as any)[field] = String(updates[field] ?? "");
      }
    }

    if (updates.score !== undefined || updates.score_override !== undefined) {
      const rawScore = updates.score_override !== undefined ? updates.score_override : updates.score;
      const parsed = Number(rawScore);
      if (!Number.isFinite(parsed)) {
        return NextResponse.json({ error: "Score must be a number." }, { status: 400 });
      }
      const clamped = Math.max(0, Math.min(100, Math.round(parsed)));
      matched.score = clamped;
      matched.score_override = clamped;
    }

    matched.employee_id = nextId;
    matched.manually_edited = true;

    const serialized = JSON.stringify(employees, null, 2);
    await writeFile(jsonPath, serialized, "utf8");
    await writePersistedJson("employees.json", serialized).catch((err) => {
      console.warn("Failed to persist employees.json after Corp Pool edit:", err);
    });
    cacheStore.invalidate("employees");

    await writeLog(
      "employee",
      "UPDATE_CORP_POOL_EMPLOYEE",
      "success",
      `Updated Corp Pool employee ${employeeId}${nextId !== employeeId ? ` -> ${nextId}` : ""}`
    );

    return NextResponse.json({ success: true, employee: matched });
  } catch (error: any) {
    await writeLog(
      "employee",
      "UPDATE_CORP_POOL_EMPLOYEE_FAILED",
      "failed",
      `Failed to update Corp Pool employee ${employeeId || "unknown"}: ${error.message}`
    );
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
    const loadEmployees = async (): Promise<EmployeeRecord[]> => {
      try {
        const persisted = await readPersistedJson("employees.json");
        if (persisted) return JSON.parse(persisted) as EmployeeRecord[];
      } catch {}
      try {
        const raw = await readFile(jsonPath, "utf8");
        return JSON.parse(raw) as EmployeeRecord[];
      } catch {
        return [];
      }
    };

    const employees = await loadEmployees();
    if (!employees.length) {
      return NextResponse.json({ error: "Employees not loaded" }, { status: 404 });
    }

    const idSet = new Set(targetIds.map((id) => String(id)));
    const removed = employees.filter((emp) => idSet.has(emp.employee_id));
    const remaining = employees.filter((emp) => !idSet.has(emp.employee_id));
    if (removed.length === 0) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const serialized = JSON.stringify(remaining, null, 2);
    await writeFile(jsonPath, serialized, "utf8");
    await writePersistedJson("employees.json", serialized).catch((err) => {
      console.warn("Failed to persist employees.json after Corp Pool delete:", err);
    });
    cacheStore.invalidate("employees");

    const personalResume = (file: string) => /\.(pdf|docx|doc|txt)$/i.test(file);
    const filesToDelete = new Set(
      removed
        .map((emp) => String(emp.source_file || "").trim())
        .filter((file) => file && personalResume(file))
    );
    try {
      const storedFiles = await listDocFiles("Corp Pool");
      for (const emp of removed) {
        const empId = String(emp.employee_id || "").trim().toLowerCase();
        if (!empId || /^cv[a-f0-9]{8,}$/i.test(empId)) continue;
        for (const file of storedFiles) {
          if (personalResume(file) && file.toLowerCase().includes(empId)) {
            filesToDelete.add(file);
          }
        }
      }
    } catch (listErr) {
      console.warn("Failed to list Corp Pool files during delete:", listErr);
    }

    for (const file of filesToDelete) {
      try {
        await deleteDocFile("Corp Pool", file);
      } catch (fileErr) {
        console.warn(`Failed to delete Corp Pool file ${file}:`, fileErr);
      }
    }

    await markCorpPoolDeleted(removed.map((emp) => emp.employee_id));

    await writeLog(
      "employee",
      "DELETE_EMPLOYEE",
      "success",
      `Deleted employee IDs: ${targetIds.join(", ")}${filesToDelete.size ? `; removed files: ${Array.from(filesToDelete).join(", ")}` : ""}`
    );

    return NextResponse.json({ success: true, deleted: removed.length });
  } catch (error: any) {
    await writeLog('employee', 'DELETE_EMPLOYEE_FAILED', 'failed', `Failed to delete employees: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
