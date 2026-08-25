/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { titleCase } from "@/lib/utils";
import {
  BarChart as ReBarChart,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  LineChart,
  Line,
  ReferenceLine,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";
import { computeReadinessScore, computeSkillLevel } from "@/lib/dashboard-analytics";

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

export function DashboardInner() {
  const router = useRouter();
  const [analytics, setAnalytics] = useState<any>(null);
  const [results, setResults]     = useState<any[]>([]);
  const [assignedTest, setAssignedTest] = useState<any>(null);
  const [completedAssessment, setCompletedAssessment] = useState<any>(null);
  const [productQbEligible, setProductQbEligible] = useState(false);
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
    if (!results) return [];
    return results.filter(r => r && typeof r === 'object');
  }, [results]);

  const displayAnalytics = useMemo(() => {
    if (!analytics) return null;
    // Provide safe fallbacks for empty analytics
    const totalTestsTaken = Math.max(displayResults.length, analytics.total_tests_taken || 0);
    const averageScore = analytics.average_score || 0;
    const activeBreakdown = (analytics.subject_breakdown ?? []).filter(
      (s: any) => (s?.topic_count ?? 0) > 0
    );
    const readinessScore =
      analytics.ai_readiness_score ||
      computeReadinessScore({
        averageScore,
        totalTestsTaken,
        subjectBreakdown: activeBreakdown,
        testScores: displayResults.map((result: any) => result.accuracy_pct ?? 0),
      });

    return {
      ...analytics,
      total_tests_taken: totalTestsTaken,
      average_score: averageScore,
      ai_readiness_score: readinessScore,
      skill_level: analytics.skill_level || computeSkillLevel(readinessScore),
      xp_points: analytics.xp_points || 0,
      strongest_subject: analytics.strongest_subject?.subject_title ? analytics.strongest_subject : null,
      weakest_subject: analytics.weakest_subject?.subject_title ? analytics.weakest_subject : null,
      score_history: analytics.score_history || [],
      subject_breakdown: analytics.subject_breakdown || [],
    };
  }, [analytics, displayResults]);

  const radarData = useMemo(() => {
    const subs = (displayAnalytics?.subject_breakdown || []) as any[];
    const attempted = subs.filter((s) => s && s.topic_count > 0 && s.subject_title);
    if (attempted.length === 0) return EMPTY_RADAR;

    const mapped = attempted.slice(0, 8).map((s) => {
      const title = String(s.subject_title || "Subject");
      return {
        subject: title.length > 12 ? title.slice(0, 11) + "…" : title,
        value: typeof s.average_pct === "number" ? Math.round(s.average_pct) : 0,
      };
    });

    // A radar chart with fewer than 3 axes renders as a degenerate line/sliver instead of
    // a polygon, which reads as "broken". Pad with zero-value placeholder axes (not
    // counted toward the employee's mastery) so the shape always stays legible.
    if (mapped.length < 3) {
      const usedNames = new Set(mapped.map((m) => m.subject));
      for (const filler of EMPTY_RADAR) {
        if (mapped.length >= 3) break;
        if (!usedNames.has(filler.subject)) {
          mapped.push(filler);
          usedNames.add(filler.subject);
        }
      }
    }

    return mapped;
  }, [displayAnalytics]);

  const trendData = useMemo(() => {
    if (!displayAnalytics || !displayAnalytics.score_history) return [];
    return displayAnalytics.score_history.map((h:any) => {
      let dateLabel = "—";
      if (h.date) {
        try {
          const d = new Date(h.date);
          if (!isNaN(d.getTime())) {
            dateLabel = d.toLocaleDateString("en", { day:"numeric", month:"short" });
          }
        } catch (e) {}
      }
      return {
        date: dateLabel,
        score: typeof h.score === 'number' ? h.score : 0,
      };
    });
  }, [displayAnalytics]);

  const weekData = useMemo(() => {
    if (!displayAnalytics || !displayAnalytics.weekly_activity) return [];
    return displayAnalytics.weekly_activity.map((w:any) => {
      let label = "—";
      if (w.week_start) {
        try {
          const d = new Date(w.week_start);
          if (!isNaN(d.getTime())) {
            label = d.toLocaleDateString("en", { day:"numeric", month:"short" });
          }
        } catch (e) {}
      }
      return {
        label,
        tests: typeof w.tests_taken === 'number' ? w.tests_taken : 0,
        avg: typeof w.avg_score === 'number' ? Math.round(w.avg_score) : 0,
      };
    });
  }, [displayAnalytics]);

  const recentResults = useMemo(() => {
    const items = (displayResults ?? []).filter(r => r && typeof r === 'object');
    return items.slice(0, 10).reverse();
  }, [displayResults]);

  // ── Render — loading
  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0f4ff] flex items-center justify-center">
        <div className="text-center space-y-4">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 mx-auto"
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
          skill_level: skillLevel = "N/A" } = displayAnalytics as any;

  // ── Render — main
  return (
    <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-300">

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
              <p className="text-indigo-200 text-sm mt-1.5">Your learning journey at a glance.</p>
            </div>
          </div>
          <div className="text-right space-y-1">
            <Badge className="bg-white/20 border-0 text-white backdrop-blur-sm">{titleCase(skillLevel)}</Badge>
            <p className="text-xs text-indigo-200">
              Readiness Score
              <span className="ml-1 font-bold text-lg">{ars}</span>
              <span className="text-indigo-300"> / 100</span>
            </p>
          </div>
        </div>
      </div>

      <main className="max-w-full mx-auto px-6 md:px-12 -mt-6 pb-14 space-y-6 relative z-10">

        {assignedTest && productQbEligible && assignedTest.status !== "completed" && (
          <Card className="p-6 bg-card border border-indigo-200 dark:border-indigo-900 shadow-soft">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-primary">Assigned Product Assessment</p>
                <h2 className="mt-1 text-xl font-bold text-foreground">{assignedTest.topic_title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {assignedTest.total_questions} questions · Ready to start
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
                  {completedAssessment.recording_missing
                    ? "Your score is saved, but the proctoring video is missing. Please upload it below."
                    : "Contact your administrator if you need to retake this assessment."}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {completedAssessment.recording_missing && (
                  <Button
                    className="rounded-xl"
                    onClick={() =>
                      router.push(
                        `/employee/tests/${completedAssessment.test_id}?uploadVideo=1`
                      )
                    }
                  >
                    Upload Proctoring Video
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => router.push(`/employee/tests/${completedAssessment.test_id}`)}
                >
                  Review Results
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* ── Tab bar ───────────────────────────────────────────────────── */}
        <div className="flex gap-1 rounded-xl bg-white dark:bg-slate-900 p-1 w-fit shadow-soft border border-indigo-100 dark:border-slate-800 transition-colors duration-300">
          {([
            ["analytics", "Analytics", <BarChart3  className="w-4 h-4" />],
            ["tests",     "My Tests",  <ClipboardList className="w-4 h-4" />],
          ] as const).map(([id, label, icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                tab === id
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/30"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-indigo-50 dark:hover:bg-slate-800"
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

            <Card className="p-6 shadow-soft border border-indigo-100 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors duration-300">
              <h2 className="text-lg font-semibold mb-4 text-slate-900 dark:text-slate-100">Subject Mastery</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <RadarChart data={radarData} outerRadius="72%">
                    <PolarGrid stroke="#e0e7ff" />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} />
                    <Radar name="Score" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-6 shadow-soft border border-indigo-100 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors duration-300">
              <h2 className="text-lg font-semibold mb-4 text-slate-900 dark:text-slate-100">Score History</h2>
              {trendData.length === 0 ? (
                <EmptyChart msg="Complete a test to see your score history." />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={trendData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <ReferenceLine y={70} stroke="#c7d2fe" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} dot={{r:3}} activeDot={{r:6}} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card className="p-6 shadow-soft border border-indigo-100 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors duration-300">
              <h2 className="text-lg font-semibold mb-4 text-slate-900 dark:text-slate-100">Weekly Activity</h2>
              {weekData.length === 0 ? (
                <EmptyChart msg="We have no activity data yet. Take your first test!" />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <ReBarChart data={weekData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }} barCategoryGap="35%">
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="tests" fill="#8b5cf6" radius={[4,4,0,0]} name="Tests taken" maxBarSize={28} />
                    </ReBarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card className="p-6 shadow-soft border border-indigo-100 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors duration-300">
              <h2 className="text-lg font-semibold mb-4 text-slate-900 dark:text-slate-100">Subject Breakdown</h2>
              <div className="space-y-3">
                {(displayAnalytics.subject_breakdown ?? []).map((s:any) => (
                  <div key={s.subject_id}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium text-slate-800 dark:text-slate-200">{s.subject_title}</span>
                      <span className="text-slate-400 dark:text-slate-500">{Math.round(s.average_pct)}% · {s.topic_count} topics</span>
                    </div>
                    <div className="h-2 bg-indigo-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(4, s.average_pct)}%` }} />
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{Math.round(s.mastery_pct)} topics mastered (≥ 80%)</p>
                  </div>
                ))}
                {(displayAnalytics.subject_breakdown ?? []).length === 0 && (
                  <p className="text-sm text-slate-400 dark:text-slate-500">No subjects started yet.</p>
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
            <Card className="p-8 text-center text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 shadow-soft border border-indigo-100 dark:border-slate-800 transition-colors">
              <p className="text-lg font-medium text-slate-700 dark:text-slate-300">No tests taken yet</p>
              <p className="text-sm mt-1">
                <Link href="/employee/learn" className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">Browse subjects</Link> and take your first test.
              </p>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {recentResults.map((r: any) => (
                <Card key={r.id} className="p-5 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-850 hover:border-indigo-400 dark:hover:border-indigo-800 hover:shadow-card transition-all duration-200 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">{r.topic_title}</h3>
                      <p className="text-xs text-slate-400 dark:text-slate-500">{r.subject_title}</p>
                    </div>
                    <ScorePill pct={r.accuracy_pct} />
                  </div>
                  {(r.ai_analysis?.summary || (typeof r.ai_analysis === 'string' && r.ai_analysis)) && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">{r.ai_analysis.summary || r.ai_analysis}</p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider dark:border-slate-800 dark:text-slate-300">{titleCase(r.difficulty)}</Badge>
                    <span>·</span>
                    <span>{toDateStr(r.completed_at)}</span>
                    <span>·</span>
                    <span>{r.correct_answers}/{r.total_questions} correct</span>
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
  const r = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ""}/api/employee/analytics`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!r.ok) throw new Error("Failed to load analytics");
  return r.json();
}

async function fetchResults(token: string): Promise<any[]> {
  const r = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ""}/api/employee/results`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!r.ok) throw new Error("Failed to load results");
  return r.json();
}

async function fetchAssignedTest(token: string): Promise<any | null> {
  const r = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ""}/api/employee/assigned-test`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data?.test_id ? data : null;
}

async function fetchEmployeeProfile(token: string): Promise<any | null> {
  const r = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ""}/api/employee/auth/validate`, {
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
    <Card className="p-4 flex flex-col items-start gap-2 bg-white dark:bg-slate-900 shadow-soft border border-indigo-100 dark:border-slate-800 hover:shadow-card transition-all duration-300">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/20 dark:to-violet-950/20 flex items-center justify-center ring-2 ring-indigo-100 dark:ring-slate-800">
        <Icon className="w-4 h-4 text-indigo-600 dark:text-violet-400" />
      </div>
      <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">{value}</span>
      <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">{label}</span>
    </Card>
  );
}

function EmptyChart({ msg }: { msg: string }) {
  return <div className="h-72 flex items-center justify-center text-sm text-slate-400 dark:text-slate-500">{msg}</div>;
}

function SubjectCard({ label, sub, highlight }: { label: string; sub: string; highlight?: boolean }) {
  const cls = highlight
    ? "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 ring-rose-100 dark:ring-rose-900/50"
    : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 ring-emerald-100 dark:ring-emerald-900/50";
  return (
    <Card className="p-4 flex flex-col items-start gap-2 ring-2 shadow-soft border border-indigo-100 dark:border-slate-800 bg-white dark:bg-slate-900 transition-all duration-300">
      <span className="text-[10px] text-indigo-500 dark:text-violet-400 uppercase tracking-wider font-bold">{label}</span>
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
