export type PortalProctorViolation = {
  type: string;
  timestamp?: string;
  detail?: string;
};

export function getPortalPrimaryProctoring(account: {
  test_id?: string | null;
  tests?: Array<{
    id: string;
    status?: string;
    proctoring?: {
      warningCount?: number;
      violations?: PortalProctorViolation[];
    } | null;
  }>;
}): { flagCount: number; violations: PortalProctorViolation[] } | null {
  const primary =
    account.tests?.find((t) => t.id === account.test_id) ??
    account.tests?.find((t) => t.status === "completed") ??
    account.tests?.[0];
  const proctoring = primary?.proctoring;
  if (!proctoring) return null;

  const violations = Array.isArray(proctoring.violations) ? proctoring.violations : [];
  const flagCount = proctoring.warningCount ?? violations.length;
  if (flagCount <= 0 && violations.length === 0) return null;

  return {
    flagCount: Math.max(flagCount, violations.length),
    violations,
  };
}

export function formatProctorViolationsForExport(
  violations: PortalProctorViolation[]
): string {
  if (!violations.length) return "—";
  return violations
    .map((v, i) => {
      const when = v.timestamp
        ? new Date(v.timestamp).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "";
      return `${i + 1}. ${v.type}${when ? ` (${when})` : ""}`;
    })
    .join("\n");
}
