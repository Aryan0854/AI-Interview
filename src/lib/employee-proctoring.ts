/**
 * Server-side employee test proctoring rules and validation.
 */

export const EMPLOYEE_PROCTOR_MAX_VIOLATIONS = 3;
export const EMPLOYEE_PROCTOR_VIOLATION_COOLDOWN_MS = 2500;

export type EmployeeProctoringState = {
  warningCount: number;
  violations: Array<{ type: string; timestamp: string }>;
  autoSubmitted: boolean;
  sessionStartedAt?: string | null;
  videoUploaded?: boolean;
  lastViolationAt?: string | null;
};

export function emptyProctoringState(): EmployeeProctoringState {
  return {
    warningCount: 0,
    violations: [],
    autoSubmitted: false,
    sessionStartedAt: null,
    videoUploaded: false,
    lastViolationAt: null,
  };
}

export function normalizeProctoring(raw: unknown): EmployeeProctoringState {
  if (!raw || typeof raw !== "object") return emptyProctoringState();
  const p = raw as EmployeeProctoringState;
  return {
    warningCount: Number(p.warningCount) || 0,
    violations: Array.isArray(p.violations) ? p.violations : [],
    autoSubmitted: Boolean(p.autoSubmitted),
    sessionStartedAt: p.sessionStartedAt ?? null,
    videoUploaded: Boolean(p.videoUploaded),
    lastViolationAt: p.lastViolationAt ?? null,
  };
}

export function getTestElapsedSeconds(test: {
  started_at?: string | null;
  time_limit_seconds?: number | null;
}): number | null {
  if (!test.started_at) return null;
  const started = new Date(test.started_at).getTime();
  if (Number.isNaN(started)) return null;
  return Math.floor((Date.now() - started) / 1000);
}

export function isTestTimeExpired(test: {
  started_at?: string | null;
  time_limit_seconds?: number | null;
}): boolean {
  const elapsed = getTestElapsedSeconds(test);
  const limit = test.time_limit_seconds ?? 1800;
  if (elapsed === null) return false;
  return elapsed > limit + 30; // 30s grace for clock skew / upload
}

export function getRemainingSeconds(test: {
  started_at?: string | null;
  time_limit_seconds?: number | null;
}): number | null {
  const elapsed = getTestElapsedSeconds(test);
  const limit = test.time_limit_seconds ?? 1800;
  if (elapsed === null) return limit;
  return Math.max(0, limit - elapsed);
}

export function canPatchTestProgress(
  test: { status?: string | null },
  updates: { status?: string; started_at?: string }
): { ok: true } | { ok: false; error: string } {
  const status = test.status ?? "pending";
  if (status === "completed") {
    return { ok: false, error: "Test already completed." };
  }
  if (status === "abandoned") {
    return { ok: false, error: "Test is no longer available." };
  }
  if (updates.status === "pending" && status === "in_progress") {
    return { ok: false, error: "Cannot revert an in-progress test to pending." };
  }
  return { ok: true };
}

export function canSubmitTest(test: {
  status?: string | null;
  started_at?: string | null;
  time_limit_seconds?: number | null;
}): { ok: true } | { ok: false; error: string; code?: string } {
  const status = test.status ?? "pending";
  if (status === "completed") {
    return { ok: false, error: "Test already submitted.", code: "ALREADY_COMPLETED" };
  }
  if (status === "pending") {
    return { ok: false, error: "Test has not been started.", code: "NOT_STARTED" };
  }
  if (isTestTimeExpired(test)) {
    return { ok: false, error: "Time limit exceeded.", code: "TIME_EXPIRED" };
  }
  return { ok: true };
}

export function recordProctorViolation(
  existing: EmployeeProctoringState,
  violationType: string,
  opts?: { forceAutoSubmit?: boolean }
): EmployeeProctoringState {
  const now = new Date().toISOString();
  const lastAt = existing.lastViolationAt ? new Date(existing.lastViolationAt).getTime() : 0;
  const nowMs = Date.now();

  // Server-side cooldown — ignore duplicate bursts from client
  if (lastAt && nowMs - lastAt < EMPLOYEE_PROCTOR_VIOLATION_COOLDOWN_MS) {
    return existing;
  }

  const nextCount = Math.min(
    EMPLOYEE_PROCTOR_MAX_VIOLATIONS,
    (existing.warningCount || 0) + 1
  );
  const autoSubmitted =
    opts?.forceAutoSubmit === true ||
    existing.autoSubmitted ||
    nextCount >= EMPLOYEE_PROCTOR_MAX_VIOLATIONS;

  return {
    ...existing,
    warningCount: nextCount,
    autoSubmitted,
    lastViolationAt: now,
    violations: [
      ...existing.violations,
      { type: violationType.slice(0, 120), timestamp: now },
    ],
  };
}

export function markProctorSessionStarted(existing: EmployeeProctoringState): EmployeeProctoringState {
  if (existing.sessionStartedAt) return existing;
  return {
    ...existing,
    sessionStartedAt: new Date().toISOString(),
  };
}

export function markProctorVideoUploaded(existing: EmployeeProctoringState): EmployeeProctoringState {
  return {
    ...existing,
    videoUploaded: true,
  };
}
