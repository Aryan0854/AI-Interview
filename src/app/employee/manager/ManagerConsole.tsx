"use client";

import { useEffect, useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  ResponsiveContainer,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  ClipboardList,
  UserCheck,
  TrendingUp,
  Sliders,
  Play,
  ArrowRight,
} from "lucide-react";

export function ManagerConsole() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [analytics, setAnalytics] = useState<any>(null);
  const [managerData, setManagerData] = useState<any>(null);
  const [consoleError, setConsoleError] = useState("");
  const [consoleSuccess, setConsoleSuccess] = useState("");
  
  // Simulation target
  const [simEmployeeId, setSimEmployeeId] = useState("");
  const [simSubjectId, setSimSubjectId] = useState("");
  const [simDays, setSimDays] = useState("30");
  const [simulating, setSimulating] = useState(false);

  // Review states
  const [activeTab, setActiveTab] = useState<"bloom" | "behavior" | "results">("bloom");
  const [selectedEval, setSelectedEval] = useState<any>(null);

  // Bloom Grading Form States
  const [applyScore, setApplyScore] = useState(80);
  const [analyzeScore, setAnalyzeScore] = useState(80);
  const [evaluateScore, setEvaluateScore] = useState(80);
  const [createScore, setCreateScore] = useState(80);
  const [submittingGrade, setSubmittingGrade] = useState(false);

  // Behavioral Evaluation Form States
  const [behRole, setBehRole] = useState<"RM" | "PM">("RM");
  const [behInterval, setBehInterval] = useState("30");
  const [q1, setQ1] = useState(4);
  const [q2, setQ2] = useState(4);
  const [q3, setQ3] = useState(4);
  const [q4, setQ4] = useState(4);
  const [q5, setQ5] = useState(4);
  const [behComments, setBehComments] = useState("");
  const [submittingBeh, setSubmittingBeh] = useState(false);

  // Business Results Form States
  const [prodBefore, setProdBefore] = useState(70);
  const [prodAfter, setProdAfter] = useState(85);
  const [prodMetric, setProdMetric] = useState("Task Completion %");
  const [qualBefore, setQualBefore] = useState(10); // defect rate
  const [qualAfter, setQualAfter] = useState(2);
  const [qualMetric, setQualMetric] = useState("Code Defect Rate %");
  const [csatBefore, setCsatBefore] = useState(80);
  const [csatAfter, setCsatAfter] = useState(90);
  const [costReduction, setCostReduction] = useState(5000);
  const [timeSaved, setTimeSaved] = useState(10);
  const [submittingResults, setSubmittingResults] = useState(false);

  useEffect(() => {
    const t = window.localStorage.getItem("employee_token") ?? "";
    setToken(t);
    if (!t) {
      setErr("Please sign in to access manager features.");
      setLoading(false);
      return;
    }
    loadData(t);
  }, []);

  async function loadData(t: string) {
    try {
      setLoading(true);
      const [resAnal, resMgr] = await Promise.all([
        fetch("/api/employee/effectiveness/analytics?scope=manager", {
          headers: { Authorization: `Bearer ${t}` },
          cache: "no-store"
        }),
        fetch("/api/employee/effectiveness/manager", {
          headers: { Authorization: `Bearer ${t}` },
          cache: "no-store"
        })
      ]);

      if (!resAnal.ok || !resMgr.ok) throw new Error("Failed to load manager records.");
      const dataAnal = await resAnal.json();
      const dataMgr = await resMgr.json();

      if (dataAnal.success && dataMgr.success) {
        setAnalytics(dataAnal);
        setManagerData(dataMgr);
        
        // Auto-select simulator defaults
        if (dataMgr.evaluations.length > 0) {
          setSimEmployeeId(dataMgr.evaluations[0].employee_id);
          setSimSubjectId(dataMgr.evaluations[0].subject_id);
        }
      } else {
        throw new Error(dataAnal.error || dataMgr.error || "Unknown error");
      }
    } catch (e: any) {
      setErr(e.message || "An error occurred.");
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Action Handlers
  // ---------------------------------------------------------------------------
  const handleSimulate = async () => {
    if (!simEmployeeId || !simSubjectId) return;
    setSimulating(true);
    try {
      const res = await fetch("/api/employee/effectiveness/manager", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "simulate_time",
          employeeId: simEmployeeId,
          subjectId: simSubjectId,
          days_ago: simDays
        })
      });
      const data = await res.json();
      if (data.success) {
        setConsoleSuccess("Time Travel Success! The course completion date has been shifted.");
        setConsoleError("");
        loadData(token);
      } else {
        setConsoleError(data.error || "Simulation failed");
        setConsoleSuccess("");
      }
    } catch (e) {
      setConsoleError("Error running simulation");
      setConsoleSuccess("");
    } finally {
      setSimulating(false);
    }
  };

  const handleOpenGradeBloom = (record: any) => {
    setConsoleError("");
    setConsoleSuccess("");
    setSelectedEval(record);
    setApplyScore(record.bloom_graded?.apply_score ?? 0);
    setAnalyzeScore(record.bloom_graded?.analyze_score ?? 0);
    setEvaluateScore(record.bloom_graded?.evaluate_score ?? 0);
    setCreateScore(record.bloom_graded?.create_score ?? 0);
    setSelectedEval(record);
  };

  const handleOpenBehavior = (record: any) => {
    setConsoleError("");
    setConsoleSuccess("");
    setSelectedEval(record);
    setBehRole("RM");
    setBehComments("");
    setQ1(4); setQ2(4); setQ3(4); setQ4(4); setQ5(4);
    
    // Auto-resolve due review interval based on dates
    const elapsedMs = Date.now() - new Date(record.completion_date).getTime();
    const elapsedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
    if (elapsedDays >= 90) setBehInterval("90");
    else if (elapsedDays >= 60) setBehInterval("60");
    else setBehInterval("30");
  };

  const handleOpenResults = (record: any) => {
    setConsoleError("");
    setConsoleSuccess("");
    setSelectedEval(record);
    setProdBefore(70); setProdAfter(85); setProdMetric("Task Completion %");
    setQualBefore(8); setQualAfter(2); setQualMetric("Defect rate %");
    setCsatBefore(80); setCsatAfter(92);
    setCostReduction(5000); setTimeSaved(12);
  };

  const handleSubmitBloomGrading = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingGrade(true);
    try {
      const res = await fetch("/api/employee/effectiveness/manager", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "grade_bloom",
          employeeId: selectedEval.employee_id,
          subjectId: selectedEval.subject_id,
          apply_score: Number(applyScore),
          analyze_score: Number(analyzeScore),
          evaluate_score: Number(evaluateScore),
          create_score: Number(createScore)
        })
      });
      const data = await res.json();
      if (data.success) {
        setConsoleSuccess("Bloom grading submitted successfully!");
        setConsoleError("");
        setSelectedEval(null);
        loadData(token);
      } else {
        setConsoleError(data.error || "Grading failed");
        setConsoleSuccess("");
      }
    } catch (err) {
      setConsoleError("Error submitting grades");
      setConsoleSuccess("");
    } finally {
      setSubmittingGrade(false);
    }
  };

  const handleSubmitBehavior = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingBeh(true);
    try {
      const res = await fetch("/api/employee/effectiveness/manager", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "behavior",
          employeeId: selectedEval.employee_id,
          subjectId: selectedEval.subject_id,
          evaluator_role: behRole,
          interval_days: Number(behInterval),
          q1, q2, q3, q4, q5,
          comments: behComments
        })
      });
      const data = await res.json();
      if (data.success) {
        setConsoleSuccess("Behavioral evaluation submitted successfully!");
        setConsoleError("");
        setSelectedEval(null);
        loadData(token);
      } else {
        setConsoleError(data.error || "Evaluation failed");
        setConsoleSuccess("");
      }
    } catch (err) {
      setConsoleError("Error submitting evaluation");
      setConsoleSuccess("");
    } finally {
      setSubmittingBeh(false);
    }
  };

  const handleSubmitResults = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingResults(true);
    try {
      const res = await fetch("/api/employee/effectiveness/manager", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "results",
          employeeId: selectedEval.employee_id,
          subjectId: selectedEval.subject_id,
          productivity_before: Number(prodBefore),
          productivity_after: Number(prodAfter),
          productivity_metric: prodMetric,
          quality_before: Number(qualBefore),
          quality_after: Number(qualAfter),
          quality_metric: qualMetric,
          customer_csat_before: Number(csatBefore),
          customer_csat_after: Number(csatAfter),
          cost_reduction: Number(costReduction),
          time_saved_hours: Number(timeSaved)
        })
      });
      const data = await res.json();
      if (data.success) {
        setConsoleSuccess("Business results outcomes saved successfully!");
        setConsoleError("");
        setSelectedEval(null);
        loadData(token);
      } else {
        setConsoleError(data.error || "Results submission failed");
        setConsoleSuccess("");
      }
    } catch (err) {
      setConsoleError("Error saving outcomes");
      setConsoleSuccess("");
    } finally {
      setSubmittingResults(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Data Filtering for Queues
  // ---------------------------------------------------------------------------
  const pendingBloomReviews = useMemo(() => {
    if (!managerData) return [];
    return managerData.evaluations.filter(
      (e: any) => e.bloom_submissions?.apply_evidence && !e.bloom_graded?.apply_score
    );
  }, [managerData]);

  const teamTimelineStatuses = useMemo(() => {
    if (!managerData) return [];
    return managerData.evaluations.map((item: any) => {
      const elapsedMs = Date.now() - new Date(item.completion_date).getTime();
      const elapsedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
      
      const behaviors = managerData.behavior_evaluations.filter(
        (b: any) => b.employee_id === item.employee_id && b.subject_id === item.subject_id
      );

      const has30 = behaviors.some((b: any) => b.interval_days === 30);
      const has60 = behaviors.some((b: any) => b.interval_days === 60);
      const has90 = behaviors.some((b: any) => b.interval_days === 90);

      const due30 = elapsedDays >= 30 && !has30;
      const due60 = elapsedDays >= 60 && !has60;
      const due90 = elapsedDays >= 90 && !has90;

      return {
        ...item,
        elapsedDays,
        has30, has60, has90,
        due30, due60, due90,
        results_complete: managerData.business_impacts.some(
          (b: any) => b.employee_id === item.employee_id && b.subject_id === item.subject_id
        ),
      };
    });
  }, [managerData]);

  return (
    <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-12 transition-colors duration-300">
      
      {/* Page Header */}
      <div className="bg-gradient-to-br from-indigo-850 via-slate-900 to-indigo-950 text-white px-6 pt-10 pb-16 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-4 right-8 w-40 h-40 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-1/4 w-60 h-60 bg-violet-400 rounded-full blur-3xl" />
        </div>
        <div className="max-w-full mx-auto px-6 md:px-12 flex flex-wrap items-end justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 mb-3">
              <UserCheck className="w-3.5 h-3.5 text-indigo-200" />
              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-100">Reporting &amp; Project Manager View</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight">Manager Evaluation Console</h1>
            <p className="text-indigo-200 text-sm mt-1.5">Review cognitive competencies, submit surveys, and input business impact ROI.</p>
          </div>
          <div className="text-right space-y-1">
            <span className="text-xs text-indigo-200 uppercase tracking-widest block font-bold">Team Avg Impact Score</span>
            <span className="text-4xl font-black text-emerald-400">{analytics?.team_training_impact ?? 0}%</span>
          </div>
        </div>
      </div>

      <main className="max-w-full mx-auto px-6 md:px-12 -mt-8 pb-14 space-y-8 relative z-10">
        
        {consoleError && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 px-4 py-3 rounded-2xl flex items-center gap-3.5 shadow-sm animate-fade-in text-xs font-semibold">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span className="flex-grow">{consoleError}</span>
            <button onClick={() => setConsoleError("")} className="text-red-400 hover:text-red-650 font-bold ml-auto px-1.5 text-xs">✕</button>
          </div>
        )}

        {consoleSuccess && (
          <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-4 py-3 rounded-2xl flex items-center gap-3.5 shadow-sm animate-fade-in text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="flex-grow">{consoleSuccess}</span>
            <button onClick={() => setConsoleSuccess("")} className="text-emerald-400 hover:text-emerald-650 font-bold ml-auto px-1.5 text-xs">✕</button>
          </div>
        )}
        
        {/* Simulator Widget + Small Charts Grid */}
        <section className="grid gap-6 lg:grid-cols-3">
          
          {/* Time Travel Simulator */}
          <Card className="p-6 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Sliders className="w-4 h-4 text-indigo-600 dark:text-violet-400" />
                <h2 className="text-base font-bold">Evaluation Timeline Simulator</h2>
              </div>
              <p className="text-xs text-slate-400 mb-4">Fast-forward training completion dates to immediately trigger 30, 60, or 90 day manager reviews and Level 4 results alerts.</p>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Select Employee</label>
                  <select 
                    value={simEmployeeId}
                    onChange={(e) => setSimEmployeeId(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 bg-slate-50 dark:bg-slate-850 dark:border-slate-700 outline-none"
                  >
                    {managerData?.evaluations.map((e: any) => (
                      <option key={e.id} value={e.employee_id}>{e.employee_name} ({e.employee_id})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Select Subject</label>
                  <select 
                    value={simSubjectId}
                    onChange={(e) => setSimSubjectId(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 bg-slate-50 dark:bg-slate-850 dark:border-slate-700 outline-none"
                  >
                    {managerData?.evaluations
                      .filter((e: any) => e.employee_id === simEmployeeId)
                      .map((e: any) => (
                        <option key={e.id} value={e.subject_id}>{e.subject_title}</option>
                      ))
                    }
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Simulate Time Travel</label>
                  <select 
                    value={simDays}
                    onChange={(e) => setSimDays(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 bg-slate-50 dark:bg-slate-850 dark:border-slate-700 outline-none"
                  >
                    <option value="30">30 Days Ago (Triggers 30-day RM/PM Review)</option>
                    <option value="60">60 Days Ago (Triggers 60-day RM/PM Review)</option>
                    <option value="90">90 Days Ago (Triggers 90-day & Level 4 Business Impact)</option>
                  </select>
                </div>
              </div>
            </div>

            <Button 
              onClick={handleSimulate} 
              disabled={simulating || !simEmployeeId}
              className="mt-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs gap-1.5 h-10 w-full"
            >
              {simulating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              Run Time Simulation
            </Button>
          </Card>

          {/* Behavior trends chart */}
          <Card className="p-6 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft">
            <h2 className="text-sm font-extrabold mb-3">Behavioral Change Trends</h2>
            <div className="h-56">
              {analytics?.behavioral_change_trends ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart data={analytics.behavioral_change_trends}>
                    <XAxis dataKey="name" tick={{ fontSize: 10, fontWeight: "bold" }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
                    <Tooltip />
                    <Bar dataKey="score" fill="#6366f1" radius={[4,4,0,0]} name="Avg Behavior %" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-slate-400 text-xs text-center py-12">No data yet</div>
              )}
            </div>
          </Card>

          {/* Application scores */}
          <Card className="p-6 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft overflow-y-auto max-h-[300px]">
            <h2 className="text-sm font-extrabold mb-3">Active Employee Application Scores</h2>
            <div className="space-y-3">
              {analytics?.employee_application_scores.map((item: any, idx: number) => (
                <div key={idx} className="flex justify-between items-center text-xs py-1 border-b border-indigo-50 dark:border-slate-855">
                  <div>
                    <p className="font-bold text-slate-800 dark:text-slate-200">{item.employee_name}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{item.subject_title}</p>
                  </div>
                  <Badge className="bg-emerald-50 text-emerald-600 border border-emerald-100 text-[10px] font-black">{item.application_score}%</Badge>
                </div>
              ))}
              {(!analytics?.employee_application_scores || analytics.employee_application_scores.length === 0) && (
                <p className="text-xs text-slate-400">No application scores logged yet.</p>
              )}
            </div>
          </Card>
        </section>

        {/* Task lists segments navigation */}
        <section className="space-y-6">
          <div className="flex gap-2 rounded-xl bg-white dark:bg-slate-900 p-1 w-fit border border-indigo-100 dark:border-slate-800">
            {([
              ["bloom", "Bloom Open Grading Queue", pendingBloomReviews.length],
              ["behavior", "Kirkpatrick Level 3 (Behavior)", teamTimelineStatuses.filter((s:any)=>s.due30 || s.due60 || s.due90).length],
              ["results", "Kirkpatrick Level 4 (Business Outcomes)", teamTimelineStatuses.filter((s:any)=>s.elapsedDays>=90 && !s.results_complete).length]
            ] as const).map(([id, label, count]) => (
              <button
                key={id}
                onClick={() => { setActiveTab(id); setSelectedEval(null); }}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all duration-200 ${
                  activeTab === id
                    ? "bg-gradient-to-r from-indigo-600 to-violet-650 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                }`}
              >
                {label} {count > 0 && <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-red-500 text-white rounded-full font-black">{count}</span>}
              </button>
            ))}
          </div>

          {/* Tab 1: Bloom open response grading */}
          {activeTab === "bloom" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-6 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft">
                <h3 className="font-extrabold text-sm mb-4">Pending Bloom Submissions</h3>
                <div className="space-y-3">
                  {pendingBloomReviews.map((record: any) => (
                    <div key={record.id} className="flex justify-between items-center p-3.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 rounded-2xl transition border border-indigo-50/50">
                      <div>
                        <p className="text-xs font-black text-slate-800 dark:text-slate-200">{record.employee_name}</p>
                        <p className="text-[10px] text-slate-400 mt-1 font-bold">{record.subject_title}</p>
                      </div>
                      <Button size="sm" onClick={() => handleOpenGradeBloom(record)} className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black h-8 px-3">
                        Grade Answers →
                      </Button>
                    </div>
                  ))}
                  {pendingBloomReviews.length === 0 && (
                    <p className="text-xs text-slate-400 py-6 text-center">No pending Bloom open responses to grade.</p>
                  )}
                </div>
              </Card>

              {/* Grading Form Panel */}
              {selectedEval && activeTab === "bloom" && (
                <Card className="p-6 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft space-y-4">
                  <div>
                    <h3 className="font-extrabold text-sm text-indigo-700">Grading Bloom Answers</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{selectedEval.employee_name} · {selectedEval.subject_title}</p>
                  </div>

                  <form onSubmit={handleSubmitBloomGrading} className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
                    <GradingRow level="Apply (Workplace evidence)" submission={selectedEval.bloom_submissions?.apply_evidence} score={applyScore} setScore={setApplyScore} />
                    <GradingRow level="Analyze (RCA diagnosis)" submission={selectedEval.bloom_submissions?.analyze_text} score={analyzeScore} setScore={setAnalyzeScore} />
                    <GradingRow level="Evaluate (Design trade-offs)" submission={selectedEval.bloom_submissions?.evaluate_text} score={evaluateScore} setScore={setEvaluateScore} />
                    <GradingRow level="Create (Innovation proposal)" submission={selectedEval.bloom_submissions?.create_text} score={createScore} setScore={setCreateScore} />

                    <Button type="submit" disabled={submittingGrade} className="w-full bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl h-10 font-bold text-xs">
                      {submittingGrade ? "Saving Grades..." : "Save Scores & Graded Status"}
                    </Button>
                  </form>
                </Card>
              )}
            </div>
          )}

          {/* Tab 2: Kirkpatrick Level 3 (Behavioral Evaluations 30/60/90 days) */}
          {activeTab === "behavior" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-6 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft">
                <h3 className="font-extrabold text-sm mb-4">Team Behavioral Milestones</h3>
                <div className="space-y-4">
                  {teamTimelineStatuses.map((record: any) => {
                    const dueList = [];
                    if (record.due30) dueList.push("30-Day");
                    if (record.due60) dueList.push("60-Day");
                    if (record.due90) dueList.push("90-Day");

                    return (
                      <div key={record.id} className="p-4 bg-slate-50 dark:bg-slate-855 rounded-2xl border border-indigo-50/50 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                        <div>
                          <p className="text-xs font-black text-slate-800 dark:text-slate-200">{record.employee_name}</p>
                          <p className="text-[10px] text-slate-400 font-bold mt-0.5">{record.subject_title}</p>
                          <div className="flex gap-1.5 mt-2">
                            <TimelinePill label="30D" complete={record.has30} />
                            <TimelinePill label="60D" complete={record.has60} />
                            <TimelinePill label="90D" complete={record.has90} />
                          </div>
                        </div>
                        <div>
                          {dueList.length > 0 ? (
                            <div className="flex flex-col items-end gap-1.5">
                              <Badge className="bg-red-500 text-white font-extrabold text-[9px] px-2 py-0.5">{dueList.join(", ")} Due</Badge>
                              <Button size="sm" onClick={() => handleOpenBehavior(record)} className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black h-8 px-3">
                                Start Review
                              </Button>
                            </div>
                          ) : (
                            <Badge className="bg-emerald-500 text-white font-extrabold text-[9px] px-2 py-0.5">Reviews Complete</Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Behavior Review Form */}
              {selectedEval && activeTab === "behavior" && (
                <Card className="p-6 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft space-y-4">
                  <div>
                    <h3 className="font-extrabold text-sm text-indigo-700">Submit Behavioral Evaluation</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{selectedEval.employee_name} · {selectedEval.subject_title}</p>
                  </div>

                  <form onSubmit={handleSubmitBehavior} className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Evaluator Role</label>
                        <select 
                           value={behRole}
                           onChange={(e: any) => setBehRole(e.target.value)}
                           className="w-full text-xs p-2 rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-850 outline-none font-bold"
                        >
                          <option value="RM">Reporting Manager (RM)</option>
                          <option value="PM">Project Manager (PM)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Interval Milestone</label>
                        <select 
                           value={behInterval}
                           onChange={(e: any) => setBehInterval(e.target.value)}
                           className="w-full text-xs p-2 rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-850 outline-none font-bold"
                        >
                          <option value="30">30-Day Checkup</option>
                          <option value="60">60-Day Checkup</option>
                          <option value="90">90-Day Checkup</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <RatingScale label="1. Employee demonstrates learned skills in daily work" rating={q1} setRating={setQ1} />
                      <RatingScale label="2. Employee independently applies new knowledge" rating={q2} setRating={setQ2} />
                      <RatingScale label="3. Employee shares learning with team members" rating={q3} setRating={setQ3} />
                      <RatingScale label="4. Employee solves problems using training concepts" rating={q4} setRating={setQ4} />
                      <RatingScale label="5. Employee shows measurable performance improvement" rating={q5} setRating={setQ5} />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Manager Comments &amp; Observation Details</label>
                      <textarea
                        className="w-full text-xs p-3 border border-slate-200 bg-slate-50 dark:bg-slate-850 rounded-xl outline-none focus:border-indigo-500 h-16"
                        placeholder="Detail specific instances or evidence observed..."
                        value={behComments}
                        onChange={(e) => setBehComments(e.target.value)}
                        required
                      />
                    </div>

                    <Button type="submit" disabled={submittingBeh} className="w-full bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl h-10 font-bold text-xs">
                      {submittingBeh ? "Saving Review..." : "Submit Evaluation Report"}
                    </Button>
                  </form>
                </Card>
              )}
            </div>
          )}

          {/* Tab 3: Kirkpatrick Level 4 (Business Outcomes) */}
          {activeTab === "results" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-6 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft">
                <h3 className="font-extrabold text-sm mb-4">Pending Business Outcomes Logs</h3>
                <p className="text-xs text-slate-400 mb-4">Required 90 days after training completion to measure KPI improvements and ROI.</p>
                <div className="space-y-3">
                  {teamTimelineStatuses
                    .filter((s: any) => s.elapsedDays >= 90)
                    .map((record: any) => (
                      <div key={record.id} className="p-3.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 rounded-2xl border border-indigo-50/50 flex justify-between items-center">
                        <div>
                          <p className="text-xs font-black text-slate-800 dark:text-slate-200">{record.employee_name}</p>
                          <p className="text-[10px] text-slate-400 font-bold mt-1">{record.subject_title}</p>
                        </div>
                        <div>
                          {record.results_complete ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-100 text-[10px]">Logged</Badge>
                          ) : (
                            <Button size="sm" onClick={() => handleOpenResults(record)} className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black h-8 px-3">
                              Log Outcome KPIs
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  {teamTimelineStatuses.filter((s: any) => s.elapsedDays >= 90).length === 0 && (
                    <p className="text-xs text-slate-400 py-6 text-center">No team members are past 90 days to log results.</p>
                  )}
                </div>
              </Card>

              {/* Results Outcomes Form */}
              {selectedEval && activeTab === "results" && (
                <Card className="p-6 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft space-y-4">
                  <div>
                    <h3 className="font-extrabold text-sm text-indigo-700">Log Training Outcomes &amp; KPI Shift</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{selectedEval.employee_name} · {selectedEval.subject_title}</p>
                  </div>

                  <form onSubmit={handleSubmitResults} className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
                    <div className="border border-indigo-50 dark:border-slate-800 p-3 rounded-2xl space-y-3 bg-slate-50/30">
                      <p className="text-[10px] font-black uppercase text-indigo-600">Productivity KPI</p>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <label className="text-[9px] text-slate-400 font-bold uppercase">Metric Label</label>
                          <input type="text" value={prodMetric} onChange={(e)=>setProdMetric(e.target.value)} className="w-full text-xs p-2 rounded-lg border bg-white outline-none" required />
                        </div>
                        <div>
                          <label className="text-[9px] text-slate-400 font-bold uppercase">Before</label>
                          <input type="number" value={prodBefore} onChange={(e)=>setProdBefore(Number(e.target.value))} className="w-full text-xs p-2 rounded-lg border bg-white outline-none" required />
                        </div>
                        <div className="col-span-2" />
                        <div>
                          <label className="text-[9px] text-slate-400 font-bold uppercase">After</label>
                          <input type="number" value={prodAfter} onChange={(e)=>setProdAfter(Number(e.target.value))} className="w-full text-xs p-2 rounded-lg border bg-white outline-none" required />
                        </div>
                      </div>
                    </div>

                    <div className="border border-indigo-50 dark:border-slate-800 p-3 rounded-2xl space-y-3 bg-slate-50/30">
                      <p className="text-[10px] font-black uppercase text-indigo-600">Quality KPI</p>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <label className="text-[9px] text-slate-400 font-bold uppercase">Metric Label</label>
                          <input type="text" value={qualMetric} onChange={(e)=>setQualMetric(e.target.value)} className="w-full text-xs p-2 rounded-lg border bg-white outline-none" required />
                        </div>
                        <div>
                          <label className="text-[9px] text-slate-400 font-bold uppercase">Before</label>
                          <input type="number" value={qualBefore} onChange={(e)=>setQualBefore(Number(e.target.value))} className="w-full text-xs p-2 rounded-lg border bg-white outline-none" required />
                        </div>
                        <div className="col-span-2" />
                        <div>
                          <label className="text-[9px] text-slate-400 font-bold uppercase">After</label>
                          <input type="number" value={qualAfter} onChange={(e)=>setQualAfter(Number(e.target.value))} className="w-full text-xs p-2 rounded-lg border bg-white outline-none" required />
                        </div>
                      </div>
                    </div>

                    <div className="border border-indigo-50 dark:border-slate-800 p-3 rounded-2xl space-y-3 bg-slate-50/30">
                      <p className="text-[10px] font-black uppercase text-indigo-600">Customer CSAT KPI</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[9px] text-slate-400 font-bold uppercase">CSAT Before %</label>
                          <input type="number" value={csatBefore} onChange={(e)=>setCsatBefore(Number(e.target.value))} className="w-full text-xs p-2 rounded-lg border bg-white outline-none" required />
                        </div>
                        <div>
                          <label className="text-[9px] text-slate-400 font-bold uppercase">CSAT After %</label>
                          <input type="number" value={csatAfter} onChange={(e)=>setCsatAfter(Number(e.target.value))} className="w-full text-xs p-2 rounded-lg border bg-white outline-none" required />
                        </div>
                      </div>
                    </div>

                    <div className="border border-indigo-50 dark:border-slate-800 p-3 rounded-2xl space-y-3 bg-slate-50/30">
                      <p className="text-[10px] font-black uppercase text-indigo-600">Financial &amp; Operational Impact</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[9px] text-slate-400 font-bold uppercase">Cost Savings ($)</label>
                          <input type="number" value={costReduction} onChange={(e)=>setCostReduction(Number(e.target.value))} className="w-full text-xs p-2 rounded-lg border bg-white outline-none" required />
                        </div>
                        <div>
                          <label className="text-[9px] text-slate-400 font-bold uppercase">Weekly Time Saved (Hours)</label>
                          <input type="number" value={timeSaved} onChange={(e)=>setTimeSaved(Number(e.target.value))} className="w-full text-xs p-2 rounded-lg border bg-white outline-none" required />
                        </div>
                      </div>
                    </div>

                    <Button type="submit" disabled={submittingResults} className="w-full bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl h-10 font-bold text-xs">
                      {submittingResults ? "Saving Outcomes..." : "Submit Outcomes report"}
                    </Button>
                  </form>
                </Card>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function GradingRow({ level, submission, score, setScore }: { level: string; submission: string | undefined; score: number; setScore: (n: number) => void }) {
  return (
    <div className="space-y-1.5 border-b border-indigo-50 dark:border-slate-850 pb-3">
      <Badge className="bg-indigo-150 text-indigo-850 font-bold text-[9px] px-2 py-0.5 uppercase">{level}</Badge>
      <div className="p-3 bg-slate-50 dark:bg-slate-855 text-xs text-slate-700 dark:text-slate-350 rounded-xl leading-relaxed italic border border-slate-100">
        &ldquo;{submission || "No text submitted"}&rdquo;
      </div>
      <div className="flex items-center justify-between gap-4 mt-2">
        <label className="text-[9px] text-slate-400 font-bold uppercase">Assigned Score (0-100)</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="0"
            max="100"
            value={score}
            onChange={(e) => setScore(Number(e.target.value))}
            className="w-24 accent-indigo-600"
          />
          <span className="text-xs font-black text-indigo-700 w-8 text-right">{score}%</span>
        </div>
      </div>
    </div>
  );
}

function RatingScale({ label, rating, setRating }: { label: string; rating: number; setRating: (n: number) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 leading-tight">{label}</p>
      <div className="flex gap-2.5">
        {[1, 2, 3, 4, 5].map((idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setRating(idx)}
            className={`flex-1 py-1 rounded-lg border text-center text-xs font-bold transition ${
              rating === idx
                ? "bg-indigo-600 border-indigo-600 text-white"
                : "bg-slate-50 border-slate-200 text-slate-400 dark:bg-slate-850 dark:border-slate-800"
            }`}
          >
            {idx}
          </button>
        ))}
      </div>
    </div>
  );
}

function TimelinePill({ label, complete }: { label: string; complete: boolean }) {
  const cls = complete 
    ? "bg-emerald-50 text-emerald-655 border-emerald-200" 
    : "bg-slate-50 text-slate-400 border-slate-200 dark:bg-slate-850 dark:border-slate-800";
  return (
    <span className={`text-[9px] font-black border px-1.5 py-0.5 rounded-md ${cls}`}>
      {label}: {complete ? "✓" : "!"}
    </span>
  );
}
