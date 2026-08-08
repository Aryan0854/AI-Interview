export type PortalTestStatus =
  | "unassigned"
  | "not_started"
  | "in_progress"
  | "pending"
  | "completed";

export const PORTAL_TEST_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "unassigned", label: "Unassigned" },
] as const;

export type PortalTestStatusFilter = (typeof PORTAL_TEST_STATUS_FILTER_OPTIONS)[number]["value"];

interface DeriveStatusInput {
  assignedQuestionCount: number;
  testId: string | null;
  rawStatus: string | null | undefined;
  answeredCount: number;
  totalQuestions: number;
  startedAt: string | null;
}

export function computeTestProgress(answeredCount: number, totalQuestions: number): number {
  if (totalQuestions <= 0) return 0;
  return Math.round((answeredCount / totalQuestions) * 100);
}

/** Derive a single canonical portal status per employee. */
export function derivePortalTestStatus(input: DeriveStatusInput): PortalTestStatus {
  const { assignedQuestionCount, testId, rawStatus, answeredCount, totalQuestions, startedAt } = input;

  if (rawStatus === "completed") {
    return "completed";
  }

  const progress = computeTestProgress(answeredCount, totalQuestions);
  const hasAssignment = assignedQuestionCount > 0 || !!testId;

  if (!hasAssignment) {
    return "unassigned";
  }

  if (progress > 0 && progress < 100) {
    return "pending";
  }

  if (rawStatus === "in_progress" || !!startedAt) {
    return "in_progress";
  }

  return "not_started";
}

export function mapBackendTestStatus(raw: string | null | undefined): PortalTestStatus {
  switch (raw) {
    case "completed":
      return "completed";
    case "in_progress":
      return "in_progress";
    case "pending":
      return "not_started";
    case "abandoned":
      return "pending";
    default:
      return "unassigned";
  }
}

export function getPortalTestStatusLabel(status: PortalTestStatus | string | null | undefined): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "in_progress":
      return "In Progress";
    case "pending":
      return "Pending";
    case "not_started":
      return "Not Started";
    case "unassigned":
      return "Unassigned";
    default:
      return status ? String(status) : "—";
  }
}

export function getPortalTestStatusBadgeClass(status: PortalTestStatus | string | null | undefined): string {
  switch (status) {
    case "completed":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300";
    case "in_progress":
      return "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/35 dark:text-indigo-300";
    case "pending":
      return "bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300";
    case "not_started":
      return "bg-sky-100 text-sky-700 dark:bg-sky-950/35 dark:text-sky-300";
    case "unassigned":
      return "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400";
    default:
      return "bg-slate-100 text-slate-700 dark:bg-slate-850 dark:text-slate-300";
  }
}

export function matchesPortalTestStatusFilter(
  status: PortalTestStatus | string | null | undefined,
  filter: PortalTestStatusFilter
): boolean {
  if (filter === "all") return true;
  return status === filter;
}

export function portalScorePercent(
  score: number | null | undefined,
  scoreMax = 25
): number {
  if (score === null || score === undefined || scoreMax <= 0) return 0;
  return Math.round((score / scoreMax) * 100);
}

export function formatPortalScore(
  score: number | null | undefined,
  scoreMax = 25
): string {
  if (score === null || score === undefined) return "—";
  const pct = portalScorePercent(score, scoreMax);
  return `${score}/${scoreMax} (${pct}%)`;
}
