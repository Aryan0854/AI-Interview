/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";

const DashboardRadarChart = dynamic(() => import("./DashboardCharts").then(m => m.DashboardRadarChartFrame), { ssr: false, loading: () => <div className="animate-pulse bg-secondary rounded-lg h-72 w-full min-h-[288px]" /> });
const DashboardTrendChart = dynamic(() => import("./DashboardCharts").then(m => m.DashboardTrendChartFrame), { ssr: false, loading: () => <div className="animate-pulse bg-secondary rounded-lg h-72 w-full min-h-[288px]" /> });
const DashboardWeeklyChart = dynamic(() => import("./DashboardCharts").then(m => m.DashboardWeeklyChartFrame), { ssr: false, loading: () => <div className="animate-pulse bg-secondary rounded-lg h-72 w-full min-h-[288px]" /> });
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";
import { buildRadarDataFromBreakdown, buildRadarDataFromResults, computeReadinessScore, computeSkillLevel } from "@/lib/dashboard-analytics";

import {
  Loader2,
  Clock,
  Zap,
  Target,
  Award,
  BarChart3,
  ClipboardList,
  Sparkles,
} from "lucide-react";

const EMPTY_RADAR = [
  { subject: "ML", value: 0 }, { subject: "Data", value: 0 },
  { subject: "Python", value: 0 }, { subject: "SQL", value: 0 },
  { subject: "Cloud", value: 0 },  { subject: "MLOps", value: 0 },
];

function computeWeeklyAverage(weekStart: string, results: any[]): number {
  const start = new Date(weekStart);
  if (Number.isNaN(start.getTime())) return 0;

  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const inWeek = results.filter((result) => {
    const completed = result?.completed_at ? new Date(result.completed_at) : null;
    return completed && !Number.isNaN(completed.getTime()) && completed >= start && completed < end;
  });

  if (!inWeek.length) return 0;
  const total = inWeek.reduce((sum, result) => sum + (result.accuracy_pct ?? 0), 0);
  return Math.round(total / inWeek.length);
}

export function DashboardInner() {
  const router = useRouter();
  const [analytics, setAnalytics] = useState<any>(null);
  const [results, setResults]     = useState<any[]>([]);
  const [assignedTest, setAssignedTest] = useState<any>(null);
  const [completedAssessment, setCompletedAssessment] = useState<any>(null);
  const [productQbEligible, setProductQbEligible] = useState(false);
  const [employeeProfile, setEmployeeProfile] = useState<{ employee_id: string; full_name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState<string | null>(null);
  const [tab, setTab]       = useState<"analytics" | "tests">("analytics");

  useEffect(() => {
    let cancelled = false;
    const token = window.localStorage.getItem("employee_token") ?? "";
    if (!token) { setErr("Please sign in to access the dashboard."); setLoading(false); return; }
    (async () => {
      try {
        const [a, r, assigned, profile] = await Promise.all([
          fetchAnalytics(token),
          fetchResults(token),
          fetchAssignedTest(token),
          fetchEmployeeProfile(token),
        ]);
        if (cancelled) return;
        setAnalytics(a); setResults(r);
        setProductQbEligible(profile?.product_qb_eligible === true);
        setEmployeeProfile(
          profile?.employee_id
            ? { employee_id: profile.employee_id, full_name: profile.full_name ?? profile.employee_id }
            : null
        );
        if (assigned?.active_test) setAssignedTest(assigned.active_test);
        else if (assigned?.test_id) setAssignedTest(assigned);
        else setAssignedTest(null);
        setCompletedAssessment(assigned?.completed_test ?? null);
      } catch (e: any) { if (!cancelled) setErr(e.message); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const displayResults = useMemo(() => {
    if (!analytics) return [];
    return [...(results || [])].filter(r => r && typeof r === 'object');
  }, [analytics, results]);

  const displayAnalytics = useMemo(() => {
    if (!analytics) return null;
    
    // Provide safe fallbacks for empty analytics
    const totalTestsTaken = Math.max(displayResults.length, analytics.total_tests_taken || 0);
    const averageScore =
      totalTestsTaken > 0 ? (analytics.average_score || 0) : 0;
    const activeBreakdown = (analytics.subject_breakdown ?? []).filter(
      (s: any) => (s?.topic_count ?? 0) > 0
    );
    const readinessScore =
      totalTestsTaken > 0
        ? (analytics.ai_readiness_score ||
            computeReadinessScore({
              averageScore,
              totalTestsTaken,
              subjectBreakdown: activeBreakdown,
              testScores: displayResults.map((result: any) => result.accuracy_pct ?? 0),
            }))
        : 0;

    const merged = {
      ...analytics,
      total_tests_taken: totalTestsTaken,
      average_score: averageScore,
      ai_readiness_score: readinessScore,
      skill_level: totalTestsTaken > 0 ? (analytics.skill_level || computeSkillLevel(readinessScore)) : "beginner",
      xp_points: totalTestsTaken > 0 ? (analytics.xp_points || 0) : 0,
    };

    if (!merged.strongest_subject || !merged.strongest_subject.subject_title || merged.strongest_subject.subject_title === "—") {
      merged.strongest_subject = { subject_title: "—" };
    }
    if (!merged.weakest_subject || !merged.weakest_subject.subject_title || merged.weakest_subject.subject_title === "—") {
      merged.weakest_subject = { subject_title: "—" };
    }

    if (!merged.score_history) merged.score_history = [];
    if (!merged.subject_breakdown) merged.subject_breakdown = [];

    return merged;
  }, [analytics, displayResults]);

  const activeSubjectBreakdown = useMemo(() => {
    return (displayAnalytics?.subject_breakdown ?? []).filter(
      (s: any) => (s?.topic_count ?? 0) > 0
    );
  }, [displayAnalytics]);

  const radarData = useMemo(() => {
    if (!displayAnalytics) return EMPTY_RADAR;

    const fromBreakdown = buildRadarDataFromBreakdown(activeSubjectBreakdown);
    if (fromBreakdown.some((d) => d.value > 0)) return fromBreakdown;

    return buildRadarDataFromResults(displayResults);
  }, [displayAnalytics, activeSubjectBreakdown, displayResults]);

  const hasSubjectMasteryData = useMemo(() => {
    return radarData.some((d) => d.value > 0);
  }, [radarData]);

  const trendData = useMemo(() => {
    const source = displayResults.length
      ? displayResults.map((result: any) => ({
          date: result.completed_at,
          score: result.accuracy_pct ?? 0,
        }))
      : (displayAnalytics?.score_history ?? []);

    return source
      .filter((h: any) => h?.date)
      .map((h: any) => {
        let dateLabel = "—";
        try {
          const d = new Date(h.date);
          if (!Number.isNaN(d.getTime())) {
            dateLabel = d.toLocaleDateString("en", { day: "numeric", month: "short" });
          }
        } catch (e) {}
        return {
          date: dateLabel,
          score: typeof h.score === "number" ? h.score : 0,
        };
      });
  }, [displayAnalytics, displayResults]);

  const weekData = useMemo(() => {
    if (!displayAnalytics?.weekly_activity) return [];
    return displayAnalytics.weekly_activity
      .filter((w: any) => (w?.tests_taken ?? 0) > 0)
      .map((w: any) => {
        let label = "—";
        if (w.week_start) {
          try {
            const d = new Date(w.week_start);
            if (!Number.isNaN(d.getTime())) {
              label = d.toLocaleDateString("en", { day: "numeric", month: "short" });
            }
          } catch (e) {}
        }
        const avgFromResults = computeWeeklyAverage(w.week_start, displayResults);
        const avgScore =
          typeof w.avg_score === "number" && w.avg_score > 0
            ? Math.round(w.avg_score)
            : avgFromResults;

        return {
          label,
          tests: typeof w.tests_taken === "number" ? w.tests_taken : 0,
          avg: avgScore,
        };
      });
  }, [displayAnalytics, displayResults]);

  const recentResults = useMemo(() => {
    const items = (displayResults ?? []).filter((r) => r && typeof r === "object");
    return items
      .sort((a, b) => {
        const aTime = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const bTime = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 10);
  }, [displayResults]);

  // ── Render — loading
  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0f4ff] flex items-center justify-center">
        <div className="text-center space-y-4">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-indigo-500/30 mx-auto"
          >
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </motion.div>
          <p className="text-slate-500 font-medium">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  // ── Render — error
  if (err) {
    return (
      <div className="min-h-screen bg-[#f0f4ff] flex items-center justify-center p-6">
        <Card className="max-w-md p-6 text-center space-y-4 border-red-200 bg-red-50">
          <p className="text-red-600 font-medium">Error: {err}</p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </Card>
      </div>
    );
  }

  if (!displayAnalytics) return null;

  const { strongest_subject: strongest, weakest_subject: weakest, ai_readiness_score: ars,
          skill_level: skillLevel = "N/A" } = (displayAnalytics ?? {
            strongest_subject: { subject_title: "—" },
            weakest_subject: { subject_title: "—" },
            ai_readiness_score: 0,
            skill_level: "N/A",
          }) as any;

  // ── Render — main
  return (
    <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 text-foreground transition-colors duration-300">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 text-white px-6 pt-10 pb-16 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-4 right-8 w-40 h-40 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-1/4 w-60 h-60 bg-violet-400 rounded-full blur-3xl" />
        </div>
        <div className="max-w-full mx-auto px-6 md:px-12 flex flex-wrap items-end justify-between gap-4 relative z-10">
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
              {employeeProfile && (
                <p className="mt-1 text-sm font-semibold text-indigo-100">
                  {employeeProfile.full_name?.trim() || employeeProfile.employee_id}
                  <span className="mx-2 text-indigo-300">·</span>
                  ID: {employeeProfile.employee_id}
                </p>
              )}
              <p className="text-indigo-200 text-sm mt-1.5">
                {productQbEligible
                  ? "Your learning topics and assigned product question bank."
                  : "Your learning journey at a glance."}
              </p>
            </div>
          </div>
          <div className="text-right space-y-1">
            <Badge className="bg-white/20 border-0 text-white backdrop-blur-sm capitalize">{skillLevel}</Badge>
            <p className="text-xs text-indigo-200">
              Readiness Score
              <span className="ml-1 font-bold text-lg">{ars}</span>
              <span className="text-indigo-300"> / 100</span>
            </p>
          </div>
        </div>
      </div>

      <main className="max-w-full mx-auto px-6 md:px-12 -mt-6 pb-14 space-y-6 relative z-10">

        {assignedTest && productQbEligible && (
          <Card className="p-6 bg-card border border-indigo-200 dark:border-indigo-900 shadow-soft">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-primary">Assigned Product Assessment</p>
                <h2 className="mt-1 text-xl font-bold text-foreground">{assignedTest.topic_title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {assignedTest.total_questions} questions ·{" "}
                  {assignedTest.status === "in_progress"
                    ? "In progress — resume where you left off"
                    : "Ready to start"}
                </p>
              </div>
              <Button
                className="rounded-xl"
                onClick={() => router.push(`/employee/tests/${assignedTest.test_id}`)}
              >
                {assignedTest.status === "in_progress" ? "Resume Assessment" : "Start Assessment"}
              </Button>
            </div>
          </Card>
        )}

        {!assignedTest && completedAssessment && productQbEligible && (
          <Card className="p-6 bg-card border border-emerald-200 dark:border-emerald-900/60 shadow-soft">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Assessment Completed
                </p>
                <h2 className="mt-1 text-xl font-bold text-foreground">{completedAssessment.topic_title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Score: {completedAssessment.score_correct}/{completedAssessment.total_questions} (
                  {completedAssessment.score_percent}%)
                  {completedAssessment.completed_at
                    ? ` · ${toDateStr(completedAssessment.completed_at)}`
                    : ""}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Contact your administrator if you need to retake this assessment.
                </p>
              </div>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => router.push(`/employee/tests/${completedAssessment.test_id}`)}
              >
                Review Results
              </Button>
            </div>
          </Card>
        )}

        {/* ── Tab bar ───────────────────────────────────────────────────── */}
        <div className="flex gap-1 rounded-xl bg-card p-1 w-fit shadow-soft border border-border transition-colors duration-300">
          {([
            ["analytics", "Analytics", <BarChart3  className="w-4 h-4" />],
            ["tests",     "My Tests",  <ClipboardList className="w-4 h-4" />],
          ] as const).map(([id, label, icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                tab === id
                  ? "bg-primary text-white shadow-md shadow-indigo-500/30"
                  : "text-muted-foreground hover:text-slate-900 dark:hover:text-slate-100 hover:bg-secondary"
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* TAB 1 — Analytics                                               */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {tab === "analytics" && (
        <div className="space-y-8" key="analytics">

          {/* ── Overview cards ───────────────────────────────────────────────── */}
          <section aria-label="Overview" className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Tests Taken" value={displayAnalytics.total_tests_taken}   icon={Clock}       />
            <StatCard label="Avg Score"   value={`${displayAnalytics.average_score}%`}  icon={Target}      />
            <StatCard label="Readiness"   value={`${ars}%`}                      icon={Sparkles}      />
            <StatCard label="XP Points"   value={displayAnalytics.xp_points || displayAnalytics.ai_readiness_score}   icon={Award}       />
            <SubjectCard label="Strongest Subject" sub={strongest?.subject_title ?? "—"} />
            <SubjectCard label="Weakest Subject"   sub={weakest   ?.subject_title ?? "—"} highlight />
          </section>

          {/* ── Charts row ────────────────────────────────────────────────── */}
          <section aria-label="Analytics charts" className="grid gap-6 lg:grid-cols-2">

            <Card className="p-6 shadow-soft border border-border bg-card transition-colors duration-300">
              <h2 className="text-lg font-semibold mb-4 text-foreground">Subject Mastery</h2>
              {!hasSubjectMasteryData ? (
                <EmptyChart msg="Complete a test to see your subject mastery." />
              ) : (
                <div className="h-72 w-full min-h-[288px] min-w-0">
                  <DashboardRadarChart data={radarData} />
                </div>
              )}
            </Card>

            <Card className="p-6 shadow-soft border border-border bg-card transition-colors duration-300">
              <h2 className="text-lg font-semibold mb-4 text-foreground">Score History</h2>
              {trendData.length === 0 ? (
                <EmptyChart msg="Complete a test to see your score history." />
              ) : (
                <div className="h-72 w-full min-h-[288px] min-w-0">
                  <DashboardTrendChart data={trendData} />
                </div>
              )}
            </Card>

            <Card className="p-6 shadow-soft border border-border bg-card transition-colors duration-300">
              <h2 className="text-lg font-semibold mb-4 text-foreground">Weekly Activity</h2>
              {weekData.length === 0 ? (
                <EmptyChart msg="We have no activity data yet. Take your first test!" />
              ) : (
                <div className="h-72 w-full min-h-[288px] min-w-0">
                  <DashboardWeeklyChart data={weekData} />
                </div>
              )}
            </Card>

            <Card className="p-6 shadow-soft border border-border bg-card transition-colors duration-300">
              <h2 className="text-lg font-semibold mb-4 text-foreground">Subject Breakdown</h2>
              <div className="space-y-3">
                {activeSubjectBreakdown.map((s:any) => (
                  <div key={s.subject_id}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium text-slate-800 dark:text-slate-200">{s.subject_title}</span>
                      <span className="text-muted-foreground">{Math.round(s.average_pct)}% · {s.topic_count} topics</span>
                    </div>
                    <div className="h-2 bg-indigo-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(0, s.average_pct)}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{Math.round(s.mastery_pct)} topics mastered (≥ 80%)</p>
                  </div>
                ))}
                {activeSubjectBreakdown.length === 0 && (
                  <p className="text-sm text-muted-foreground">No subjects started yet.</p>
                )}
              </div>
            </Card>

          </section>
        </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* TAB 2 — My Tests                                                */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {tab === "tests" && (
        <div key="tests" className="space-y-4">

          {recentResults.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground bg-card shadow-soft border border-border transition-colors">
              <p className="text-lg font-medium text-muted-foreground">No tests taken yet</p>
              <p className="text-sm mt-1">
                <Link href="/employee/learn" className="text-primary hover:underline font-medium">Browse subjects</Link> and take your first test.
              </p>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {recentResults.map((r: any) => (
                <Card key={r.id} className="p-5 bg-card border border-indigo-100 dark:border-slate-850 hover:border-indigo-400 dark:hover:border-indigo-800 hover:shadow-card transition-all duration-200 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm text-foreground truncate">{r.topic_title}</h3>
                      <p className="text-xs text-muted-foreground">{r.subject_title}</p>
                    </div>
                    <ScorePill pct={r.accuracy_pct} />
                  </div>
                  <div className="rounded-lg bg-secondary/60 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Score</p>
                    <p className="text-lg font-extrabold text-foreground">
                      {r.correct_answers}/{r.total_questions}
                      <span className="ml-1 text-sm font-semibold text-muted-foreground">({r.accuracy_pct}%)</span>
                    </p>
                  </div>
                  {r.ai_analysis && typeof r.ai_analysis === "string" && (
                    <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">{r.ai_analysis}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wider dark:border-slate-800 dark:text-slate-300">{r.difficulty}</Badge>
                      <span>{toDateStr(r.completed_at)}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg text-xs font-bold shrink-0"
                      onClick={() => router.push(`/employee/tests/${r.id}`)}
                    >
                      Review
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
        )}

      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

async function fetchAnalytics(token: string): Promise<any> {
  const r = await fetch("/api/employee/analytics", {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!r.ok) throw new Error("Failed to load analytics");
  return r.json();
}

async function fetchResults(token: string): Promise<any[]> {
  const r = await fetch("/api/employee/results", {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!r.ok) throw new Error("Failed to load results");
  return r.json();
}

async function fetchAssignedTest(token: string): Promise<any | null> {
  const r = await fetch("/api/employee/assigned-test", {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!r.ok) return null;
  const data = await r.json();
  if (data?.active_test || data?.completed_test) return data;
  if (data?.test_id) return data;
  return null;
}

async function fetchEmployeeProfile(token: string): Promise<any | null> {
  const r = await fetch("/api/employee/auth/validate", {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data?.employee ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateStr(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch (e) {
    return "—";
  }
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <Card className="p-4 flex flex-col items-start gap-2 bg-card shadow-soft border border-border hover:shadow-card transition-all duration-300">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/20 dark:to-violet-950/20 flex items-center justify-center ring-2 ring-indigo-100 dark:ring-slate-800">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <span className="text-2xl font-extrabold text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
    </Card>
  );
}

function EmptyChart({ msg }: { msg: string }) {
  return <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">{msg}</div>;
}

function SubjectCard({ label, sub, highlight }: { label: string; sub: string; highlight?: boolean }) {
  const cls = highlight
    ? "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 ring-rose-100 dark:ring-rose-900/50"
    : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 ring-emerald-100 dark:ring-emerald-900/50";
  return (
    <Card className="p-4 flex flex-col items-start gap-2 ring-2 shadow-soft border border-border bg-card transition-all duration-300">
      <span className="text-[10px] text-primary dark:text-violet-400 uppercase tracking-wider font-bold">{label}</span>
      <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${cls}`}>{sub}</span>
    </Card>
  );
}

function ScorePill({ pct }: { pct: number }) {
  const cls = pct >= 80 ? "bg-emerald-100 text-emerald-700 border-emerald-200"
            : pct >= 60 ? "bg-amber-100  text-amber-700  border-amber-200"
            :              "bg-red-100   text-red-700   border-red-200";
  return <Badge className={`${cls} border text-xs font-bold`}>{pct}%</Badge>;
}
