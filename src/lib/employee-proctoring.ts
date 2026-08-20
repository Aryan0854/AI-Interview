/**
 * Server-side employee test proctoring rules and validation.
 */

export const EMPLOYEE_PROCTOR_MAX_VIOLATIONS = 3;
export const EMPLOYEE_PROCTOR_VIOLATION_COOLDOWN_MS = 2500;
/** Ignore proctor violations briefly after entering the running phase (camera/fullscreen prompts). */
export const EMPLOYEE_PROCTOR_START_GRACE_MS = 20_000;

export type ProctorAnomalyCategory =
  | "face"
  | "attention"
  | "browser"
  | "camera"
  | "session"
  | "other";

export type ProctorAnomalySeverity = "low" | "medium" | "high";

export type ProctorViolation = {
  type: string;
  timestamp: string;
  category?: ProctorAnomalyCategory;
  severity?: ProctorAnomalySeverity;
  detail?: string;
};

export type EmployeeProctoringState = {
  warningCount: number;
  violations: ProctorViolation[];
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

export function classifyProctorAnomaly(type: string): {
  category: ProctorAnomalyCategory;
  severity: ProctorAnomalySeverity;
} {
  const t = type.toLowerCase();
  if (t.includes("multiple face")) return { category: "face", severity: "high" };
  if (t.includes("face missing") || t.includes("face not")) return { category: "face", severity: "high" };
  if (t.includes("looking down") || t.includes("phone")) return { category: "attention", severity: "high" };
  if (t.includes("looking away") || t.includes("distracted")) return { category: "attention", severity: "medium" };
  if (t.includes("camera")) return { category: "camera", severity: "high" };
  if (t.includes("recording")) return { category: "camera", severity: "medium" };
  if (t.includes("tab") || t.includes("focus") || t.includes("fullscreen") || t.includes("devtools") || t.includes("copy") || t.includes("paste") || t.includes("refresh") || t.includes("print") || t.includes("right click") || t.includes("navigation")) {
    return { category: "browser", severity: "medium" };
  }
  return { category: "other", severity: "low" };
}

export function normalizeProctoring(raw: unknown): EmployeeProctoringState {
  if (!raw || typeof raw !== "object") return emptyProctoringState();
  const p = raw as EmployeeProctoringState;
  const violations = Array.isArray(p.violations)
    ? p.violations.map((v) => {
        const type = String(v?.type ?? "Unknown").slice(0, 120);
        const classified = classifyProctorAnomaly(type);
        return {
          type,
          timestamp: v?.timestamp ? String(v.timestamp) : new Date().toISOString(),
          category: v?.category || classified.category,
          severity: v?.severity || classified.severity,
          detail: v?.detail ? String(v.detail).slice(0, 240) : undefined,
        };
      })
    : [];

  return {
    warningCount: Number(p.warningCount) || 0,
    violations,
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
  opts?: { forceAutoSubmit?: boolean; detail?: string; category?: ProctorAnomalyCategory; severity?: ProctorAnomalySeverity }
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

  const classified = classifyProctorAnomaly(violationType);

  return {
    ...existing,
    warningCount: nextCount,
    autoSubmitted,
    lastViolationAt: now,
    violations: [
      ...existing.violations,
      {
        type: violationType.slice(0, 120),
        timestamp: now,
        category: opts?.category || classified.category,
        severity: opts?.severity || classified.severity,
        detail: opts?.detail ? opts.detail.slice(0, 240) : undefined,
      },
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
