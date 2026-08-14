export const RADAR_AXES = ["ML", "Data", "Python", "SQL", "Cloud", "MLOps"] as const;

export type RadarAxis = (typeof RADAR_AXES)[number];

export function subjectTitleToRadarAxis(title: string): RadarAxis | null {
  const t = title.toLowerCase().trim();
  if (!t) return null;

  if (t.includes("machine learning") || t.includes("ai / ml") || t === "ml") return "ML";
  if (t.includes("artificial intelligence") && !t.includes("machine learning")) return "ML";
  if (t.includes("sql") || t.includes("database")) return "SQL";
  if (t.includes("data science") || t === "data") return "Data";
  if (t.includes("python")) return "Python";
  if (t.includes("cloud")) return "Cloud";
  if (t.includes("mlops")) return "MLOps";

  return null;
}

export function buildRadarDataFromBreakdown(
  breakdown: Array<{ subject_title?: string; average_pct?: number; topic_count?: number }>
) {
  const scores: Record<RadarAxis, number> = {
    ML: 0,
    Data: 0,
    Python: 0,
    SQL: 0,
    Cloud: 0,
    MLOps: 0,
  };

  for (const item of breakdown) {
    if ((item.topic_count ?? 0) <= 0) continue;
    const axis = subjectTitleToRadarAxis(item.subject_title || "");
    if (!axis) continue;
    scores[axis] = Math.max(scores[axis], Math.round(item.average_pct || 0));
  }

  return RADAR_AXES.map((subject) => ({ subject, value: scores[subject] }));
}

export function buildRadarDataFromResults(
  results: Array<{ subject_title?: string; topic_title?: string; accuracy_pct?: number }>
) {
  const scores: Record<RadarAxis, number> = {
    ML: 0,
    Data: 0,
    Python: 0,
    SQL: 0,
    Cloud: 0,
    MLOps: 0,
  };

  for (const result of results) {
    const title = result.subject_title || result.topic_title || "";
    const axis = subjectTitleToRadarAxis(title);
    if (!axis) continue;
    scores[axis] = Math.max(scores[axis], Math.round(result.accuracy_pct || 0));
  }

  return RADAR_AXES.map((subject) => ({ subject, value: scores[subject] }));
}

export function computeSkillLevel(readinessScore: number): string {
  if (readinessScore >= 80) return "advanced";
  if (readinessScore >= 60) return "intermediate";
  if (readinessScore > 0) return "beginner";
  return "beginner";
}

/**
 * Readiness score (0-100) derived from completed test performance.
 */
export function computeReadinessScore(options: {
  averageScore: number;
  totalTestsTaken: number;
  subjectBreakdown?: Array<{ average_pct?: number; topic_count?: number }>;
  testScores?: number[];
}): number {
  const { averageScore, totalTestsTaken, subjectBreakdown = [], testScores = [] } = options;

  if (totalTestsTaken <= 0 && testScores.length === 0) {
    return 0;
  }

  const activeSubjects = subjectBreakdown.filter((s) => (s.topic_count ?? 0) > 0);
  const subjectAverage =
    activeSubjects.length > 0
      ? activeSubjects.reduce((sum, s) => sum + (s.average_pct ?? 0), 0) / activeSubjects.length
      : 0;

  const perTestAverage =
    testScores.length > 0
      ? testScores.reduce((sum, score) => sum + score, 0) / testScores.length
      : 0;

  const base = Math.max(averageScore, subjectAverage, perTestAverage);
  if (base <= 0) return 0;

  // Reward exploring more subjects without overpowering accuracy.
  const breadthBonus = Math.min(Math.max(activeSubjects.length - 1, 0) * 2, 10);

  return Math.min(100, Math.round(base + breadthBonus));
}
