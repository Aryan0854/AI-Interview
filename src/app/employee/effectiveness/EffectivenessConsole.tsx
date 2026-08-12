"use client";

import { useEffect, useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from "recharts";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Clock,
  Sparkles,
  ClipboardList,
  MessageSquare,
  Award,
  Zap,
  TrendingUp,
  Brain,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";

export function EffectivenessConsole() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [analytics, setAnalytics] = useState<any>(null);
  const [activeModal, setActiveModal] = useState<"none" | "survey" | "bloom">("none");
  const [selectedSubject, setSelectedSubject] = useState<any>(null);
  const [modalError, setModalError] = useState("");
  
  // Survey Form States
  const [relevance, setRelevance] = useState(5);
  const [utility, setUtility] = useState(5);
  const [instructor, setInstructor] = useState(5);
  const [nps, setNps] = useState(9);
  const [surveyComments, setSurveyComments] = useState("");
  const [submittingSurvey, setSubmittingSurvey] = useState(false);

  // Bloom Test States
  const [bloomQuestions, setBloomQuestions] = useState<any[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [bloomAnswers, setBloomAnswers] = useState<Record<string, any>>({});
  const [submittingBloom, setSubmittingBloom] = useState(false);

  useEffect(() => {
    const t = window.localStorage.getItem("employee_token") ?? "";
    setToken(t);
    if (!t) {
      setErr("Please sign in to access post-training metrics.");
      setLoading(false);
      return;
    }
    loadData(t);
  }, []);

  async function loadData(t: string) {
    try {
      setLoading(true);
      const res = await fetch("/api/employee/effectiveness/analytics", {
        headers: { Authorization: `Bearer ${t}` },
        cache: "no-store"
      });
      if (!res.ok) throw new Error("Failed to load effectiveness analytics.");
      const data = await res.json();
      if (data.success) {
        setAnalytics(data);
      } else {
        throw new Error(data.error || "Unknown error");
      }
    } catch (e: any) {
      setErr(e.message || "An error occurred.");
    } finally {
      setLoading(false);
    }
  }

  // NPS Categories
  const npsText = useMemo(() => {
    if (analytics?.reaction_score >= 80) return "Highly Satisfied (Promoters)";
    if (analytics?.reaction_score >= 60) return "Satisfied (Passives)";
    return "Needs Improvement (Detractors)";
  }, [analytics]);

  const handleOpenSurvey = (subj: any) => {
    setSelectedSubject(subj);
    setRelevance(5);
    setUtility(5);
    setInstructor(5);
    setNps(9);
    setSurveyComments("");
    setModalError("");
    setActiveModal("survey");
  };

  const handleOpenBloom = async (subj: any) => {
    setSelectedSubject(subj);
    setLoadingQuestions(true);
    setBloomAnswers({});
    setModalError("");
    setActiveModal("bloom");
    try {
      const res = await fetch(`/api/employee/effectiveness/bloom-test?subjectId=${subj.subject_id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setBloomQuestions(data.questions);
      } else {
        setModalError(data.error || "Failed to load questions");
      }
    } catch (e) {
      setModalError("Error loading questions");
    } finally {
      setLoadingQuestions(false);
    }
  };

  const handleSubmitSurvey = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingSurvey(true);
    try {
      const res = await fetch("/api/employee/effectiveness/evaluations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type: "reaction",
          subjectId: selectedSubject.subject_id,
          subjectTitle: selectedSubject.subject_title,
          relevance,
          utility,
          instructor,
          nps,
          comments: surveyComments
        })
      });
      const data = await res.json();
      if (data.success) {
        setActiveModal("none");
        loadData(token);
      } else {
        setModalError(data.error || "Submission failed");
      }
    } catch (err) {
      setModalError("Error submitting survey");
    } finally {
      setSubmittingSurvey(false);
    }
  };

  const handleSubmitBloom = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate that Remember and Understand MCQs are answered
    if (bloomAnswers.remember === undefined || bloomAnswers.understand === undefined) {
      setModalError("Please answer all multiple-choice questions first.");
      return;
    }
    setSubmittingBloom(true);
    setModalError("");
    try {
      const res = await fetch("/api/employee/effectiveness/bloom-test", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          subjectId: selectedSubject.subject_id,
          subjectTitle: selectedSubject.subject_title,
          answers: bloomAnswers
        })
      });
      const data = await res.json();
      if (data.success) {
        setActiveModal("none");
        loadData(token);
      } else {
        setModalError(data.error || "Submission failed");
      }
    } catch (err) {
      setModalError("Error submitting assessment");
    } finally {
      setSubmittingBloom(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto" />
          <p className="text-slate-500 font-medium">Loading post-training analytics…</p>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 flex items-center justify-center p-6">
        <Card className="max-w-md p-6 text-center space-y-4 border-red-200 bg-red-50 dark:bg-slate-900">
          <p className="text-red-600 font-medium">{err}</p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </Card>
      </div>
    );
  }

  if (analytics && analytics.total_evaluations === 0) {
    return (
      <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 flex items-center justify-center p-6">
        <Card className="max-w-md p-8 text-center space-y-3">
          <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">No post-training evaluations yet</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            These metrics populate once a reaction survey, knowledge assessment, and manager evaluation have been completed for a training subject. Nothing has been submitted yet.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-300 pb-12">
      {/* Page Header */}
      <div className="bg-gradient-to-br from-indigo-700 via-indigo-850 to-violet-850 text-white px-6 pt-10 pb-16 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-4 right-8 w-40 h-40 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-1/4 w-60 h-60 bg-violet-400 rounded-full blur-3xl" />
        </div>
        <div className="max-w-full mx-auto px-6 md:px-12 flex flex-wrap items-end justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 mb-3">
              <Brain className="w-3.5 h-3.5 text-indigo-200" />
              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-100">Kirkpatrick &amp; Bloom Model</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight">Post-Training Effectiveness</h1>
            <p className="text-indigo-200 text-sm mt-1.5">Measuring skill acquisition, behavioral change, and business outcomes.</p>
          </div>
          <div className="text-right space-y-1">
            <span className="text-xs text-indigo-200 uppercase tracking-widest block font-bold">Effectiveness Index (TEI)</span>
            <span className="text-4xl font-black text-emerald-400">{analytics.training_effectiveness_score}%</span>
          </div>
        </div>
      </div>

      <main className="max-w-full mx-auto px-6 md:px-12 -mt-8 pb-14 space-y-8 relative z-10">
        
        {/* Metric Summaries Grid */}
        <section className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Card className="p-5 flex flex-col justify-between bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft">
            <div className="flex justify-between items-start">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Level 1: Reaction</span>
              <Badge className="bg-indigo-50 text-indigo-600 dark:bg-slate-850 dark:text-indigo-400">Satisfaction</Badge>
            </div>
            <div className="mt-4">
              <span className="text-3xl font-black">{analytics.reaction_score}%</span>
              <span className="text-[10px] text-slate-400 block mt-1 font-semibold">{npsText}</span>
            </div>
          </Card>
          
          <Card className="p-5 flex flex-col justify-between bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft">
            <div className="flex justify-between items-start">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Level 2: Learning</span>
              <Badge className="bg-blue-50 text-blue-600 dark:bg-slate-850 dark:text-blue-400">Knowledge Gain</Badge>
            </div>
            <div className="mt-4">
              <span className="text-3xl font-black">{analytics.learning_score}%</span>
              <span className="text-[10px] text-emerald-500 flex items-center gap-1 mt-1 font-bold">
                <TrendingUp className="w-3.5 h-3.5" /> +{analytics.competency_development_score}% Growth
              </span>
            </div>
          </Card>

          <Card className="p-5 flex flex-col justify-between bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft">
            <div className="flex justify-between items-start">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Level 3: Behavior</span>
              <Badge className="bg-purple-50 text-purple-600 dark:bg-slate-850 dark:text-purple-400">Application</Badge>
            </div>
            <div className="mt-4">
              <span className="text-3xl font-black">{analytics.behavior_score}%</span>
              <span className="text-[10px] text-slate-400 block mt-1 font-semibold">Retention: {analytics.knowledge_retention_score}%</span>
            </div>
          </Card>

          <Card className="p-5 flex flex-col justify-between bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft">
            <div className="flex justify-between items-start">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Level 4: Results</span>
              <Badge className="bg-emerald-50 text-emerald-600 dark:bg-slate-850 dark:text-emerald-400">Business Impact</Badge>
            </div>
            <div className="mt-4">
              <span className="text-3xl font-black">{analytics.results_score}%</span>
              <span className="text-[10px] text-slate-400 block mt-1 font-semibold">Verified outcomes mapped</span>
            </div>
          </Card>
        </section>

        {/* Competency Analysis */}
        <section className="grid gap-6 lg:grid-cols-3">
          {/* recharts Radar */}
          <Card className="p-6 lg:col-span-2 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft">
            <div className="mb-4">
              <h2 className="text-lg font-bold">Bloom's Taxonomy Competency Profile</h2>
              <p className="text-xs text-slate-400">Weighted competency score across cognitive complexity levels.</p>
            </div>
            <div className="h-72 flex justify-center items-center">
              {analytics.bloom_radar.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <RadarChart cx="50%" cy="50%" outerRadius="80%" data={analytics.bloom_radar}>
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: "#64748b", fontSize: 11, fontWeight: "bold" }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} />
                    <Radar name="Maturity" dataKey="value" stroke="#4f46e5" fill="#6366f1" fillOpacity={0.25} />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-slate-400 text-sm">Submit your first Bloom assessment to view profile.</div>
              )}
            </div>
          </Card>

          {/* Scores Breakdown */}
          <Card className="p-6 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 shadow-soft flex flex-col justify-between">
            <div>
              <h2 className="text-base font-bold mb-4">Competency Index</h2>
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between items-center text-sm font-semibold mb-1">
                    <span>Learning Maturity</span>
                    <span className="text-indigo-600">{analytics.learning_maturity_score}%</span>
                  </div>
                  <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${analytics.learning_maturity_score}%` }} />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Weighted integration of all cognitive complexity stages.</p>
                </div>

                <div>
                  <div className="flex justify-between items-center text-sm font-semibold mb-1">
                    <span>Competency Development</span>
                    <span className="text-blue-600">+{analytics.competency_development_score}%</span>
                  </div>
                  <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, analytics.competency_development_score)}%` }} />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Calculated knowledge baseline-to-post-training increase.</p>
                </div>

                <div>
                  <div className="flex justify-between items-center text-sm font-semibold mb-1">
                    <span>Knowledge Retention</span>
                    <span className="text-purple-600">{analytics.knowledge_retention_score}%</span>
                  </div>
                  <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-500 rounded-full" style={{ width: `${analytics.knowledge_retention_score}%` }} />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Measures long-term recall against 30/60/90 day active application.</p>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 text-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Training Effectiveness Index</span>
              <span className="text-3xl font-black text-indigo-600 dark:text-violet-400 mt-1 block">{analytics.training_effectiveness_score}%</span>
            </div>
          </Card>
        </section>

        {/* Kirkpatrick Timeline Tracker */}
        <section className="space-y-4">
          <h2 className="text-lg font-bold">Your Training Programs &amp; Timeline Trackers</h2>
          <div className="space-y-6">
            {analytics.milestones.map((prog: any) => (
              <Card key={prog.subject_id} className="p-6 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-850 shadow-soft">
                <div className="flex justify-between items-center flex-wrap gap-2 border-b border-indigo-50 dark:border-slate-855 pb-4 mb-6">
                  <div>
                    <h3 className="font-extrabold text-sm text-slate-900 dark:text-slate-100">{prog.subject_title}</h3>
                    <p className="text-xs text-slate-400 mt-1">Completed: {new Date(prog.completion_date).toLocaleDateString()} · Elapsed: {prog.elapsed_days} Days</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!prog.reaction_complete && (
                      <Button size="sm" onClick={() => handleOpenSurvey(prog)} className="rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-slate-800 dark:text-indigo-300 font-bold text-xs gap-1 border-0 shadow-sm">
                        <MessageSquare className="w-3.5 h-3.5" /> Reaction Survey
                      </Button>
                    )}
                    {!prog.bloom_complete && (
                      <Button size="sm" onClick={() => handleOpenBloom(prog)} className="rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs gap-1 shadow-md shadow-violet-500/20">
                        <Zap className="w-3.5 h-3.5" /> Bloom Quiz
                      </Button>
                    )}
                    {prog.reaction_complete && prog.bloom_complete && (
                      <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 border border-emerald-200">
                        Assessments Complete
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Timeline node track */}
                <div className="relative flex justify-between items-start w-full px-2">
                  <div className="absolute top-4 left-4 right-4 h-1 bg-slate-100 dark:bg-slate-800 -z-10" />
                  
                  {/* Step 1 */}
                  <TimelineNode label="Pre-Assessment" status={true} desc="Baseline competency" />
                  
                  {/* Step 2 */}
                  <TimelineNode label="Reaction Survey" status={prog.reaction_complete} desc="Level 1 Feedback" />
                  
                  {/* Step 3 */}
                  <TimelineNode label="Bloom quiz" status={prog.bloom_complete} desc="Level 2 Knowledge" />

                  {/* Step 4 */}
                  <TimelineNode label="30-Day check" status={prog.eval_30_complete} desc="Behavior Application" warning={prog.elapsed_days >= 30 && !prog.eval_30_complete} />

                  {/* Step 5 */}
                  <TimelineNode label="60-Day check" status={prog.eval_60_complete} desc="Behavior Application" warning={prog.elapsed_days >= 60 && !prog.eval_60_complete} />

                  {/* Step 6 */}
                  <TimelineNode label="90-Day check" status={prog.eval_90_complete} desc="Behavior Application" warning={prog.elapsed_days >= 90 && !prog.eval_90_complete} />

                  {/* Step 7 */}
                  <TimelineNode label="Business Results" status={prog.results_complete} desc="Level 4 Outcome" warning={prog.elapsed_days >= 90 && !prog.results_complete} />
                </div>
              </Card>
            ))}
          </div>
        </section>
      </main>

      {/* ── Level 1 Reaction Survey Modal ────────────────────────────── */}
      {activeModal === "survey" && selectedSubject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <Card className="w-full max-w-lg p-6 bg-white dark:bg-slate-900 border-indigo-100 shadow-2xl relative">
            <button onClick={() => setActiveModal("none")} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 font-bold">✕</button>
            <h3 className="text-lg font-black mb-1">Kirkpatrick Level 1: Reaction Survey</h3>
            <p className="text-xs text-slate-400 mb-6">{selectedSubject.subject_title}</p>
            
            {modalError && (
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 px-4 py-2.5 rounded-xl mb-4 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}
            
            <form onSubmit={handleSubmitSurvey} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Training Relevance (1-5)</label>
                <StarSelector rating={relevance} setRating={setRelevance} />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Content Utility (1-5)</label>
                <StarSelector rating={utility} setRating={setUtility} />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Instructor Effectiveness (1-5)</label>
                <StarSelector rating={instructor} setRating={setInstructor} />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Net Promoter Score - NPS (0-10)</label>
                <div className="flex gap-1 justify-between flex-wrap">
                  {Array.from({ length: 11 }).map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setNps(i)}
                      className={`w-7 h-7 text-xs font-bold rounded-lg border transition ${
                        nps === i
                          ? "bg-indigo-600 border-indigo-600 text-white"
                          : "bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700 text-slate-500"
                      }`}
                    >
                      {i}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between text-[9px] text-slate-400 mt-1 font-semibold">
                  <span>0 - Not Likely</span>
                  <span>10 - Extremely Likely</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Feedback &amp; Suggestions</label>
                <textarea
                  className="w-full text-sm p-3 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 rounded-xl outline-none focus:border-indigo-500 transition h-20"
                  placeholder="Tell us what you liked or how we can improve..."
                  value={surveyComments}
                  onChange={(e) => setSurveyComments(e.target.value)}
                />
              </div>

              <Button type="submit" disabled={submittingSurvey} className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-11">
                {submittingSurvey ? "Submitting..." : "Submit Reaction Survey"}
              </Button>
            </form>
          </Card>
        </div>
      )}

      {/* ── Bloom Taxonomy quiz Modal ────────────────────────────── */}
      {activeModal === "bloom" && selectedSubject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm overflow-y-auto">
          <Card className="w-full max-w-2xl p-6 bg-white dark:bg-slate-900 border-indigo-100 shadow-2xl relative my-8">
            <button onClick={() => setActiveModal("none")} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 font-bold">✕</button>
            <h3 className="text-lg font-black mb-1">Bloom's Taxonomy Competency Quiz</h3>
            <p className="text-xs text-slate-400 mb-6">{selectedSubject.subject_title}</p>

            {modalError && (
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 px-4 py-2.5 rounded-xl mb-4 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            {loadingQuestions ? (
              <div className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-600" /></div>
            ) : (
              <form onSubmit={handleSubmitBloom} className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
                {bloomQuestions.map((q, idx) => (
                  <div key={q.level} className="space-y-2 border-b border-indigo-50 dark:border-slate-850 pb-4">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-indigo-100 text-indigo-855 font-bold uppercase text-[9px] px-2.5 py-0.5">{q.level}</Badge>
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Question {idx + 1}</span>
                    </div>
                    <p className="text-sm font-semibold leading-relaxed">{q.question_text}</p>
                    
                    {/* MCQ Choices for levels 1 & 2 */}
                    {q.options ? (
                      <div className="space-y-2 mt-2">
                        {q.options.map((opt: string, oIdx: number) => (
                          <button
                            key={oIdx}
                            type="button"
                            onClick={() => setBloomAnswers({ ...bloomAnswers, [q.level]: oIdx })}
                            className={`w-full text-left p-3 text-xs font-semibold rounded-xl border transition ${
                              bloomAnswers[q.level] === oIdx
                                ? "bg-indigo-50 border-indigo-400 text-indigo-850 dark:bg-indigo-950/20"
                                : "bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700 text-slate-500 hover:bg-slate-100"
                            }`}
                          >
                            <span className="inline-block w-5 h-5 rounded-full border border-indigo-200 text-center leading-5 mr-2 font-bold bg-white text-indigo-700">
                              {String.fromCharCode(65 + oIdx)}
                            </span>
                            {opt}
                          </button>
                        ))}
                      </div>
                    ) : (
                      /* Text Inputs for levels 3, 4, 5, 6 */
                      <textarea
                        className="w-full text-sm p-3 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 rounded-xl outline-none focus:border-indigo-500 transition h-24"
                        placeholder={q.placeholder}
                        value={bloomAnswers[q.level] || ""}
                        onChange={(e) => setBloomAnswers({ ...bloomAnswers, [q.level]: e.target.value })}
                        required
                      />
                    )}
                  </div>
                ))}

                <Button type="submit" disabled={submittingBloom} className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold h-11">
                  {submittingBloom ? "Submitting..." : "Submit for Manager Grading"}
                </Button>
              </form>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function TimelineNode({ label, status, desc, warning }: { label: string; status: boolean; desc: string; warning?: boolean }) {
  const color = status 
    ? "bg-emerald-500 ring-emerald-100 border-emerald-500 text-white" 
    : warning 
      ? "bg-amber-500 ring-amber-100 border-amber-500 text-white"
      : "bg-slate-100 ring-slate-50 border-slate-200 text-slate-400 dark:bg-slate-800 dark:border-slate-700";
  return (
    <div className="flex flex-col items-center text-center max-w-[100px] relative">
      <div className={`w-8 h-8 rounded-full border-2 ring-4 flex items-center justify-center font-bold text-xs ${color}`}>
        {status ? "✓" : "!"}
      </div>
      <span className="text-[10px] font-extrabold text-slate-800 dark:text-slate-200 mt-2 block leading-none">{label}</span>
      <span className="text-[8px] text-slate-400 mt-1 block leading-tight">{desc}</span>
    </div>
  );
}

function StarSelector({ rating, setRating }: { rating: number; setRating: (r: number) => void }) {
  return (
    <div className="flex gap-2 text-2xl">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => setRating(star)}
          className={`transition ${star <= rating ? "text-amber-400 scale-110" : "text-slate-200 dark:text-slate-700"}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
