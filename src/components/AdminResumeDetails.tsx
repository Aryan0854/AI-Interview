"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  BarChart3,
  TrendingUp,
  CheckCircle,
  Lightbulb,
  Target,
  Star,
  X,
  MessageSquare,
  ClipboardList,
  Sparkles,
  User,
  Briefcase,
  GraduationCap,
  Award,
  BookOpen,
  Code,
  Mail,
  Phone,
  Cpu,
  ShieldAlert,
  AlertTriangle,
  Activity,
  Clock,
  Volume2,
  AppWindow,
  Users,
  UserMinus,
} from "lucide-react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AdminResumeDetailsProps {
  data: any;
  onClose: () => void;
}

export function AdminResumeDetails({ data, onClose }: AdminResumeDetailsProps) {
  const [activeTab, setActiveTab] = useState<"analysis" | "parsed" | "proctoring">("analysis");
  const report = data.report || {};
  const analysis = data.analysis || {};
  const enhanced = data.enhanced || {};

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-600 dark:text-emerald-450";
    if (score >= 60) return "text-amber-600 dark:text-amber-450";
    return "text-red-500 dark:text-red-450";
  };

  const getConfidenceColor = (conf: string) => {
    switch (conf) {
      case "very-high": return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/55 font-bold";
      case "high": return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/55 font-bold";
      case "medium": return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/55 font-bold";
      default: return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/55 font-bold";
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 bg-indigo-900/60 backdrop-blur-sm overflow-y-auto"
    >
      <div className="min-h-screen p-4">
        <div className="max-w-6xl mx-auto">
           <Card className="bg-card shadow-card border border-border overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-slate-950 dark:to-slate-900">
              <div>
                <h2 className="text-2xl font-extrabold text-foreground">Resume Analysis Details</h2>
                <p className="text-slate-600 dark:text-slate-400 mt-1">Evaluating {data.filename}</p>
              </div>
              <div className="flex flex-wrap gap-3 items-center">
                <Link href={`/admin/resumes/${data.id}`}>
                  <Button size="sm" className="gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">
                    <ClipboardList className="w-4 h-4" />
                    View Response Review
                  </Button>
                </Link>
                <Button onClick={onClose} variant="outline" size="sm" className="rounded-xl border-border text-primary hover:bg-secondary">
                  <X className="w-4 h-4" />
                  Close
                </Button>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex overflow-x-auto scrollbar-none border-b border-border bg-gradient-to-r from-indigo-50/10 to-violet-50/10 dark:from-slate-950 dark:to-slate-900/10 px-6">
              <button
                onClick={() => setActiveTab("analysis")}
                className={cn(
                  "px-5 py-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 -mb-[1px] flex-shrink-0 whitespace-nowrap",
                  activeTab === "analysis"
                    ? "border-indigo-600 dark:border-violet-500 text-primary font-extrabold"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350"
                )}
              >
                <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                AI Fit & Insights
              </button>
              <button
                onClick={() => setActiveTab("parsed")}
                className={cn(
                  "px-5 py-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 -mb-[1px] flex-shrink-0 whitespace-nowrap",
                  activeTab === "parsed"
                    ? "border-indigo-600 dark:border-violet-500 text-primary font-extrabold"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350"
                )}
              >
                <ClipboardList className="w-4 h-4 text-primary" />
                Parsed CV Structure
              </button>
              <button
                onClick={() => setActiveTab("proctoring")}
                className={cn(
                  "px-5 py-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 -mb-[1px] flex-shrink-0 whitespace-nowrap",
                  activeTab === "proctoring"
                    ? "border-indigo-600 dark:border-violet-500 text-primary font-extrabold"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350"
                )}
              >
                <ShieldAlert className={cn(
                  "w-4 h-4",
                  report.proctoring?.autoSubmitted 
                    ? "text-rose-500 animate-pulse" 
                    : (report.proctoring?.warningCount > 0 ? "text-amber-500 animate-bounce" : "text-emerald-500")
                )} />
                Proctoring Audit {report.proctoring?.warningCount > 0 && `(${report.proctoring.warningCount}/3)`}
              </button>
            </div>

            <div className="p-6 space-y-8">
              {activeTab === "analysis" ? (
                <>
                  {/* Job Description Fit Analysis */}
                  {report.jdMatchScore !== undefined && report.jdMatchScore !== null && (
                    <Card className={cn("p-6 border shadow-soft rounded-3xl", 
                      report.suitability === "suitable" 
                        ? "bg-emerald-50/50 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-900/30" 
                        : "bg-rose-50/50 dark:bg-rose-950/10 border-rose-100 dark:border-rose-900/30"
                    )}>
                      <h4 className={cn("text-xs font-black mb-3 flex items-center gap-2 uppercase tracking-widest",
                        report.suitability === "suitable" ? "text-emerald-800 dark:text-emerald-400" : "text-rose-800 dark:text-rose-450"
                      )}>
                        <Sparkles className="w-4 h-4 animate-pulse" />
                        Job Description Match Analysis
                      </h4>
                      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4 pb-4 border-b border-indigo-100/50 dark:border-slate-800/50">
                        <div className="flex items-center gap-4">
                          <div className={cn("text-3xl font-black", 
                            report.suitability === "suitable" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-455"
                          )}>
                            {report.jdMatchScore}% Match
                          </div>
                          <Badge className={cn("border-0 font-bold uppercase tracking-wider text-[10px] px-3 py-1",
                            report.suitability === "suitable" 
                              ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-400" 
                              : "bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-400"
                          )}>
                            {report.suitability === "suitable" ? "Suitable Candidate" : "Non-Suitable Candidate"}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-muted-foreground leading-relaxed text-sm font-medium">
                        <strong>Recommendation Rationale:</strong> {report.jdMatchRationale || "Matches profile requirements."}
                      </p>
                    </Card>
                  )}

                  {/* Executive Summary */}
                  {report.executiveSummary && (
                    <Card className="p-6 bg-indigo-50/50 dark:bg-slate-950/30 border-border shadow-soft">
                      <h4 className="text-sm font-bold mb-3 flex items-center gap-2 text-indigo-800 dark:text-violet-400 uppercase tracking-wider">
                        <Lightbulb className="w-4 h-4 text-amber-500" />
                        Candidate Summary
                      </h4>
                      <p className="text-slate-800 dark:text-slate-200 leading-relaxed text-base">{report.executiveSummary}</p>
                    </Card>
                  )}

                  {/* Score Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: "Fit Score", value: analysis.overallScore, icon: BarChart3 },
                      { label: "ATS Compatibility", value: analysis.atsScore, icon: Target },
                      { label: "Experience Level", value: analysis.technicalScore, icon: Star },
                      { label: "Clarity", value: analysis.communicationScore, icon: TrendingUp },
                    ].map((metric, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                      >
                        <Card className="p-5 bg-card border-border shadow-soft text-center hover:shadow-card hover:border-indigo-300 dark:hover:border-slate-700 transition-all">
                          <metric.icon className="w-6 h-6 mx-auto mb-3 text-primary" />
                          <div className={cn("text-2xl font-extrabold mb-1", getScoreColor(metric.value))}>
                            {metric.value}
                          </div>
                          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mt-1">{metric.label}</div>
                        </Card>
                      </motion.div>
                    ))}
                  </div>

                  {/* Radar Chart */}
                  {analysis.scores && (
                    <Card className="p-6 bg-card border-border shadow-soft">
                      <h4 className="text-sm font-bold mb-6 text-foreground uppercase tracking-wider">Resume Quality Radar</h4>
                      <div className="w-full h-[300px] min-w-0">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                          <RadarChart data={Object.entries(analysis.scores).map(([key, value]) => ({
                            subject: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, " $1"),
                            value: value as number,
                            fullMark: 100,
                          }))}>
                            <PolarGrid stroke="#e0e7ff" className="stroke-indigo-100 dark:stroke-slate-800" />
                            <PolarAngleAxis dataKey="subject" tick={{ fill: "#64748b", fontSize: 11 }} />
                            <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} />
                            <Radar
                              name="Score"
                              dataKey="value"
                              stroke="#6366f1"
                              fill="#8b5cf6"
                              fillOpacity={0.25}
                              strokeWidth={2}
                            />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </Card>
                  )}

                  {/* Strengths & Weaknesses */}
                  <div className="grid md:grid-cols-2 gap-6">
                    {/* Strengths */}
                    {analysis.strengths && analysis.strengths.length > 0 && (
                      <Card className="p-6 bg-card border-border shadow-soft">
                        <h4 className="text-sm font-bold mb-4 flex items-center gap-2 text-indigo-800 dark:text-violet-400 uppercase tracking-wider">
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                          Identified Strengths
                        </h4>
                        <ul className="space-y-3">
                          {analysis.strengths.map((strength: any, i: number) => (
                            <motion.li
                              key={i}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.1 }}
                              className="flex items-start gap-3"
                            >
                              <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <CheckCircle className="w-3 h-3 text-emerald-600 dark:text-emerald-405" />
                              </div>
                              <div>
                                <p className="text-slate-800 dark:text-slate-200 text-sm font-semibold">{strength.description}</p>
                                <span className="text-xs text-slate-500 dark:text-slate-450 capitalize">{strength.category}</span>
                              </div>
                            </motion.li>
                          ))}
                        </ul>
                      </Card>
                    )}

                    {/* Detailed Metrics */}
                    {analysis.scores && (
                      <Card className="p-6 bg-card border-border shadow-soft">
                        <h4 className="text-sm font-bold mb-4 flex items-center gap-2 text-indigo-800 dark:text-violet-400 uppercase tracking-wider">
                          <BarChart3 className="w-4 h-4 text-primary" />
                          Detailed Metric Breakdown
                        </h4>
                        <div className="space-y-4">
                          {Object.entries(analysis.scores).map(([key, value]: [string, any], i: number) => (
                            <div key={i} className="space-y-2">
                              <div className="flex justify-between text-sm font-bold mb-1">
                                <span className="text-slate-800 dark:text-slate-200 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                                <span style={{ color: value >= 80 ? '#10b981' : value >= 60 ? '#f59e0b' : '#ef4444' }}>
                                  {value}/100
                                </span>
                              </div>
                              <div className="h-2 bg-indigo-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <motion.div
                                  className="h-full"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${value}%` }}
                                  transition={{ duration: 1, delay: i * 0.1 }}
                                  style={{ backgroundColor: value >= 80 ? '#10b981' : value >= 60 ? '#f59e0b' : '#ef4444' }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}
                  </div>

                  {/* Recruiter Insights */}
                  {report.recruiterInsights && report.recruiterInsights.length > 0 && (
                    <Card className="p-6 bg-indigo-50/50 dark:bg-slate-950/30 border-border shadow-soft">
                      <h4 className="text-sm font-bold mb-4 flex items-center gap-2 text-indigo-800 dark:text-violet-400 uppercase tracking-wider">
                        <Target className="w-4 h-4 text-primary" />
                        Recruiter Insights
                      </h4>
                      <ul className="space-y-4">
                        {report.recruiterInsights.map((insight: string, i: number) => (
                          <motion.li
                            key={i}
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.1 }}
                            className="flex items-start gap-3 text-slate-800 dark:text-slate-250 text-sm font-semibold"
                          >
                            <span className="w-5 h-5 rounded-full bg-primary text-white text-xs flex items-center justify-center mt-0.5 flex-shrink-0 font-bold">
                              {i + 1}
                            </span>
                            {insight}
                          </motion.li>
                        ))}
                      </ul>
                    </Card>
                  )}

                  {/* Decision Factors for Recruiters */}
                  <Card className="p-6 bg-card border-border shadow-soft">
                    <h4 className="text-sm font-bold mb-4 flex items-center gap-2 text-indigo-800 dark:text-violet-400 uppercase tracking-wider">
                      <CheckCircle className="w-4 h-4 text-primary" />
                      Key Decision Factors
                    </h4>
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40">
                        <p className="text-emerald-950 dark:text-emerald-400 font-bold mb-3 text-sm">✓ Strengths to Consider</p>
                        <ul className="space-y-2">
                          {analysis.strengths && analysis.strengths.length > 0 ? (
                            analysis.strengths.map((strength: any, i: number) => (
                              <li key={i} className="text-emerald-950 dark:text-emerald-300 text-sm font-medium">• {strength.description}</li>
                            ))
                          ) : (
                            <li className="text-emerald-800 dark:text-emerald-400 text-sm opacity-70">No strengths identified</li>
                          )}
                        </ul>
                      </div>
                      <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
                        <p className="text-amber-950 dark:text-amber-400 font-bold mb-3 text-sm">Areas to Verify</p>
                        <ul className="space-y-2">
                          {analysis.weaknesses && analysis.weaknesses.length > 0 ? (
                            analysis.weaknesses.map((weak: any, i: number) => (
                              <li key={i} className="text-amber-955 dark:text-amber-300 text-sm font-medium">• {weak.description}</li>
                            ))
                          ) : (
                            <li className="text-amber-800 dark:text-amber-400 text-sm opacity-70">No concerns identified</li>
                          )}
                        </ul>
                      </div>
                      <div className="p-4 rounded-xl bg-indigo-50 dark:bg-slate-950 border border-border">
                        <p className="text-indigo-950 dark:text-slate-350 font-bold mb-3 text-sm">Recruiter Recommendation</p>
                        <p className="text-indigo-950 dark:text-slate-300 text-sm font-semibold leading-relaxed">
                          Based on the analysis, this candidate has a <span className="font-extrabold">{analysis.overallScore || 0}% fit</span> score.
                          {analysis.overallScore >= 80 ? " ✓ Strong candidate - proceed to technical review." :
                           analysis.overallScore >= 60 ? " • Good fit for discussion phase." :
                           " ○ Consider for further evaluation."}
                        </p>
                      </div>
                    </div>
                  </Card>

                  {/* Industry Fit & Suitable Roles */}
                  <div className="grid md:grid-cols-2 gap-6">
                    <Card className="p-6 bg-card border-border shadow-soft">
                      <h4 className="text-sm font-bold mb-4 text-foreground uppercase tracking-wider">Industry Fit</h4>
                      <div className="space-y-4">
                        {(report.industryFit || []).map((fit: any, i: number) => (
                          <div key={i} className="space-y-2">
                            <div className="flex justify-between text-sm font-bold mb-1">
                              <span className="text-slate-800 dark:text-slate-200">{fit.industry}</span>
                              <span className="text-primary">{fit.matchScore}%</span>
                            </div>
                            <div className="h-2 bg-indigo-100 dark:bg-slate-850 rounded-full overflow-hidden">
                              <motion.div
                                className="h-full bg-primary rounded-full"
                                initial={{ width: 0 }}
                                animate={{ width: `${fit.matchScore}%` }}
                                transition={{ duration: 1, delay: i * 0.2 }}
                              />
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{fit.rationale}</p>
                          </div>
                        ))}
                      </div>
                    </Card>

                    <Card className="p-6 bg-card border-border shadow-soft">
                      <h4 className="text-sm font-bold mb-4 text-foreground uppercase tracking-wider">Suitable Roles</h4>
                      <div className="flex flex-wrap gap-2">
                        {(report.targetRoles || []).map((role: string, i: number) => (
                          <Badge key={i} className="px-3 py-1 text-xs font-semibold text-primary bg-indigo-100 dark:bg-slate-800 border border-indigo-200 dark:border-slate-700">
                            <Star className="w-3 h-3 mr-1 text-amber-500" />
                            {role}
                          </Badge>
                        ))}
                      </div>
                    </Card>
                  </div>

                  {/* Hiring Confidence */}
                  {report.hiringConfidence && (
                    <Card className="p-6 bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-slate-950 dark:to-slate-900 border-border shadow-soft text-center">
                      <h4 className="text-sm font-bold mb-4 text-foreground uppercase tracking-wider">Hiring Confidence</h4>
                      <Badge className={cn("px-6 py-2 text-sm font-extrabold tracking-widest rounded-full border-2", getConfidenceColor(report.hiringConfidence))}>
                        {report.hiringConfidence.replace("-", " ").toUpperCase()}
                      </Badge>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Based on resume quality, relevance, and industry standards
                      </p>
                    </Card>
                  )}
                </>
              ) : activeTab === "parsed" ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-foreground">
                  {/* Left Column - Meta & Skills */}
                  <div className="space-y-6 lg:col-span-1">
                    {/* Contact & Personal Card */}
                    <Card className="p-5 bg-indigo-50/20 dark:bg-slate-900/30 border border-border shadow-soft rounded-2xl">
                      <h4 className="text-xs font-black mb-4 flex items-center gap-2 text-indigo-800 dark:text-violet-400 uppercase tracking-widest">
                        <User className="w-4 h-4 text-primary" />
                        Candidate Info
                      </h4>
                      <div className="space-y-3.5">
                        <div className="pb-3 border-b border-indigo-100/30 dark:border-slate-800">
                          <h3 className="text-xl font-extrabold text-slate-955 dark:text-slate-100">
                            {data.parsed?.personal?.fullName || "Not Found"}
                          </h3>
                          {data.parsed?.personal?.title && (
                            <p className="text-xs text-primary font-semibold mt-1">
                              {data.parsed.personal.title}
                            </p>
                          )}
                        </div>
                        {data.parsed?.personal?.email && (
                          <a href={`mailto:${data.parsed.personal.email}`} className="flex items-center gap-2.5 text-sm font-medium text-slate-700 hover:text-indigo-600 dark:text-slate-350 dark:hover:text-violet-400 transition-colors">
                            <Mail className="w-4 h-4 text-slate-450" />
                            <span className="truncate">{data.parsed.personal.email}</span>
                          </a>
                        )}
                        {data.parsed?.personal?.phone && (
                          <div className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
                            <Phone className="w-4 h-4 text-slate-400" />
                            <span>{data.parsed.personal.phone}</span>
                          </div>
                        )}
                        {data.parsed?.personal?.linkedin && (
                          <a href={data.parsed.personal.linkedin.startsWith('http') ? data.parsed.personal.linkedin : `https://${data.parsed.personal.linkedin}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 text-sm font-medium text-slate-700 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-violet-400 transition-colors">
                            <svg className="w-4 h-4 text-slate-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                              <rect x="2" y="9" width="4" height="12" />
                              <circle cx="4" cy="4" r="2" />
                            </svg>
                            <span className="truncate">LinkedIn Profile</span>
                          </a>
                        )}
                        {data.parsed?.personal?.github && (
                          <a href={data.parsed.personal.github.startsWith('http') ? data.parsed.personal.github : `https://${data.parsed.personal.github}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 text-sm font-medium text-slate-700 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-violet-400 transition-colors">
                            <svg className="w-4 h-4 text-slate-450 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                            </svg>
                            <span className="truncate">GitHub Profile</span>
                          </a>
                        )}
                      </div>
                    </Card>

                    {/* Technical Skills Card */}
                    <Card className="p-5 bg-card border border-border shadow-soft rounded-2xl">
                      <h4 className="text-xs font-black mb-4 flex items-center gap-2 text-indigo-800 dark:text-violet-400 uppercase tracking-widest">
                        <Cpu className="w-4 h-4 text-primary" />
                        Skills Profile
                      </h4>
                      <div className="space-y-4">
                        {data.parsed?.skills?.technical?.length > 0 && (
                          <div>
                            <span className="text-[10px] uppercase font-extrabold tracking-wider text-muted-foreground">Technical Skills</span>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {data.parsed.skills.technical.map((s: string, idx: number) => (
                                <span key={idx} className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-50 text-indigo-800 dark:bg-slate-800 dark:text-violet-300 inline-flex items-center">
                                  {s}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {data.parsed?.skills?.tools?.length > 0 && (
                          <div>
                            <span className="text-[10px] uppercase font-extrabold tracking-wider text-muted-foreground">Tools / Platforms</span>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {data.parsed.skills.tools.map((s: string, idx: number) => (
                                <span key={idx} className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-50 text-indigo-800 dark:bg-slate-800 dark:text-violet-300 inline-flex items-center">
                                  {s}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {data.parsed?.skills?.soft?.length > 0 && (
                          <div>
                            <span className="text-[10px] uppercase font-extrabold tracking-wider text-muted-foreground">Soft Skills</span>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {data.parsed.skills.soft.map((s: string, idx: number) => (
                                <span key={idx} className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-50 text-indigo-800 dark:bg-slate-800 dark:text-violet-300 inline-flex items-center">
                                  {s}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>

                    {/* Education Card */}
                    <Card className="p-5 bg-card border border-border shadow-soft rounded-2xl">
                      <h4 className="text-xs font-black mb-4 flex items-center gap-2 text-indigo-800 dark:text-violet-400 uppercase tracking-widest">
                        <GraduationCap className="w-4 h-4 text-primary" />
                        Education
                      </h4>
                      <div className="space-y-4 divide-y divide-indigo-50/50 dark:divide-slate-800/50">
                        {data.parsed?.education?.length > 0 ? (
                          data.parsed.education.map((edu: any, idx: number) => (
                            <div key={edu.id || idx} className={cn("space-y-1", idx > 0 && "pt-3")}>
                              <h5 className="font-extrabold text-foreground text-sm leading-snug">
                                {edu.degree || edu.institution}
                              </h5>
                              {edu.degree && edu.institution !== edu.degree && (
                                <p className="text-xs text-slate-650 dark:text-slate-400 font-medium">
                                  {edu.institution}
                                </p>
                              )}
                              {edu.graduationDate && (
                                <span className="inline-block text-[10px] font-bold text-primary bg-indigo-50/50 dark:bg-slate-800 px-2.5 py-0.5 rounded-full mt-1">
                                  Class of {edu.graduationDate}
                                </span>
                              )}
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-slate-550">No education info parsed</p>
                        )}
                      </div>
                    </Card>

                    {/* Certifications Card */}
                    {data.parsed?.certifications?.length > 0 && (
                      <Card className="p-5 bg-card border border-border shadow-soft rounded-2xl">
                        <h4 className="text-xs font-black mb-4 flex items-center gap-2 text-indigo-800 dark:text-violet-400 uppercase tracking-widest">
                          <Award className="w-4 h-4 text-primary" />
                          Certifications
                        </h4>
                        <div className="space-y-3">
                          {data.parsed.certifications.map((cert: any, idx: number) => (
                            <div key={cert.id || idx} className="flex gap-2.5 items-start">
                              <Award className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                              <div className="space-y-0.5">
                                <p className="text-xs font-extrabold text-slate-800 dark:text-slate-200 leading-snug">{cert.name}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}
                  </div>

                  {/* Right Column - Resume summary, experience timeline, and projects */}
                  <div className="space-y-6 lg:col-span-2">
                    {/* Executive Summary Statement */}
                    {data.parsed?.summary && (
                      <Card className="p-6 bg-indigo-50/20 dark:bg-slate-900/30 border border-border shadow-soft rounded-2xl relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-indigo-500 to-violet-600" />
                        <h4 className="text-xs font-black mb-3 flex items-center gap-2 text-indigo-800 dark:text-violet-400 uppercase tracking-widest">
                          <BookOpen className="w-4 h-4 text-primary" />
                          Parsed Summary
                        </h4>
                        <p className="text-muted-foreground leading-relaxed text-sm font-medium italic">
                          "{data.parsed.summary}"
                        </p>
                      </Card>
                    )}

                    {/* Experience Timeline */}
                    <Card className="p-6 bg-card border border-border shadow-soft rounded-2xl">
                      <h4 className="text-xs font-black mb-6 flex items-center gap-2 text-indigo-800 dark:text-violet-400 uppercase tracking-widest">
                        <Briefcase className="w-4 h-4 text-primary" />
                        Work Experience & Internships
                      </h4>
                      <div className="relative border-l border-border pl-6 ml-2 space-y-8">
                        {data.parsed?.experience?.length > 0 ? (
                          data.parsed.experience.map((exp: any, idx: number) => (
                            <div key={exp.id || idx} className="relative">
                              {/* Timeline Dot */}
                              <div className={cn(
                                "absolute -left-[31px] top-1.5 w-4 h-4 rounded-full border-2 flex items-center justify-center bg-card",
                                exp.current 
                                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" 
                                  : "border-indigo-500 bg-secondary"
                              )}>
                                <div className={cn(
                                  "w-1.5 h-1.5 rounded-full",
                                  exp.current ? "bg-emerald-500" : "bg-indigo-500"
                                )} />
                              </div>

                              <div className="space-y-2">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <h4 className="text-base font-extrabold text-slate-950 dark:text-slate-100 leading-tight">
                                      {exp.position}
                                    </h4>
                                    <p className="text-sm text-primary font-bold mt-0.5">
                                      {exp.company}
                                    </p>
                                  </div>
                                  <span className={cn(
                                    "px-3 py-1 text-xs font-bold tracking-wide rounded-full uppercase inline-flex items-center",
                                    exp.current 
                                      ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-extrabold"
                                      : "bg-secondary text-muted-foreground"
                                  )}>
                                    {exp.startDate} – {exp.endDate || "Present"}
                                  </span>
                                </div>

                                {exp.description && (
                                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
                                    {exp.description}
                                  </p>
                                )}

                                {exp.bulletPoints?.length > 0 && (
                                  <ul className="list-disc pl-4 space-y-1.5 text-sm text-slate-750 dark:text-slate-355">
                                    {exp.bulletPoints.map((bp: any, bpIdx: number) => {
                                      const text = typeof bp === 'string' ? bp : bp?.text || "";
                                      return (
                                        <li key={bp.id || bpIdx} className="leading-relaxed font-medium">
                                          {text}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-slate-550">No experiences parsed</p>
                        )}
                      </div>
                    </Card>

                    {/* Projects Section */}
                    {data.parsed?.projects?.length > 0 && (
                      <Card className="p-6 bg-card border border-border shadow-soft rounded-2xl">
                        <h4 className="text-xs font-black mb-6 flex items-center gap-2 text-indigo-800 dark:text-violet-400 uppercase tracking-widest">
                          <Code className="w-4 h-4 text-primary" />
                          Projects
                        </h4>
                        <div className="space-y-6">
                          {data.parsed.projects.map((proj: any, idx: number) => (
                            <div key={proj.id || idx} className="p-4 rounded-xl bg-slate-50/50 dark:bg-slate-900/50 border border-indigo-50/50 dark:border-slate-800/70 shadow-sm space-y-3">
                              <div>
                                <h4 className="text-base font-extrabold text-slate-955 dark:text-slate-100">
                                  {proj.name}
                                </h4>
                                {proj.description && proj.description !== proj.name && (
                                  <p className="text-xs text-primary font-semibold mt-0.5">
                                    {proj.description}
                                  </p>
                                )}
                              </div>

                              {proj.bulletPoints?.length > 0 && (
                                <ul className="list-disc pl-4 space-y-1.5 text-sm text-slate-750 dark:text-slate-350">
                                  {proj.bulletPoints.map((bp: any, bpIdx: number) => {
                                    const text = typeof bp === 'string' ? bp : bp?.text || "";
                                    return (
                                      <li key={bpIdx} className="leading-relaxed font-medium">
                                        {text}
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}
                  </div>
                </div>
              ) : (
                /* AI Proctoring Audit Log Content */
                <div className="space-y-6 text-foreground">
                  {/* Compliance Summary Header banner */}
                  {report.proctoring?.autoSubmitted ? (
                    <div className="p-6 rounded-3xl bg-red-50 dark:bg-rose-950/20 border border-red-200 dark:border-rose-900/40 flex items-start gap-4 shadow-sm animate-pulse">
                      <div className="p-3 bg-red-100 dark:bg-rose-900/50 rounded-2xl text-red-650 dark:text-red-400">
                        <ShieldAlert className="w-6 h-6 animate-bounce" />
                      </div>
                      <div>
                        <h3 className="text-lg font-black text-red-800 dark:text-red-400">
                          Assessment Auto-Submitted (Critical Integrity Failure)
                        </h3>
                        <p className="text-sm text-red-700 dark:text-red-300 font-medium mt-1 leading-relaxed">
                          The system automatically terminated and submitted the test session because the candidate exceeded the maximum threshold of 3 integrity warnings. Review the detailed timeline of events below.
                        </p>
                      </div>
                    </div>
                  ) : report.proctoring?.warningCount > 0 ? (
                    <div className="p-6 rounded-3xl bg-amber-50/50 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/30 flex items-start gap-4 shadow-sm">
                      <div className="p-3 bg-amber-100 dark:bg-amber-900/40 rounded-2xl text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="w-6 h-6 animate-pulse" />
                      </div>
                      <div>
                        <h3 className="text-lg font-black text-amber-800 dark:text-amber-450">
                          Integrity Flags Registered
                        </h3>
                        <p className="text-sm text-amber-700 dark:text-amber-300 font-medium mt-1 leading-relaxed">
                          The candidate triggered {report.proctoring.warningCount} warning(s) during the assessment. Ensure you audit the flagged timestamps before rendering a final hiring decision.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 rounded-3xl bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-100 dark:border-emerald-900/30 flex items-start gap-4 shadow-sm">
                      <div className="p-3 bg-emerald-100 dark:bg-emerald-900/40 rounded-2xl text-emerald-600 dark:text-emerald-400">
                        <CheckCircle className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-lg font-black text-emerald-800 dark:text-emerald-400">
                          Assessment Monitored & Secure
                        </h3>
                        <p className="text-sm text-emerald-700 dark:text-emerald-300 font-medium mt-1 leading-relaxed">
                          Active AI-powered proctoring was enabled. The candidate successfully completed the session with a clean record and 0 security violations recorded.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 4-Card Stats Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card className="p-5 bg-card border-border shadow-soft">
                      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Compliance Status</div>
                      <div className={cn(
                        "text-xl font-extrabold capitalize",
                        report.proctoring?.autoSubmitted ? "text-rose-500" : (report.proctoring?.warningCount > 0 ? "text-amber-500" : "text-emerald-500")
                      )}>
                        {report.proctoring?.autoSubmitted ? "Disqualified" : (report.proctoring?.warningCount > 0 ? "Flagged" : "Compliant")}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">Audit status level</div>
                    </Card>

                    <Card className="p-5 bg-card border-border shadow-soft">
                      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Warning Count</div>
                      <div className="text-2xl font-black text-foreground">
                        {report.proctoring?.warningCount || 0} <span className="text-slate-450 text-sm">/ 3</span>
                      </div>
                      <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden mt-1.5">
                        <div 
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            report.proctoring?.warningCount === 1 ? "bg-amber-400 w-1/3" :
                            report.proctoring?.warningCount === 2 ? "bg-amber-600 w-2/3" :
                            report.proctoring?.warningCount >= 3 ? "bg-rose-500 w-full" : "w-0"
                          )}
                        />
                      </div>
                    </Card>

                    <Card className="p-5 bg-card border-border shadow-soft">
                      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Integrity Score</div>
                      <div className={cn(
                        "text-2xl font-black",
                        report.proctoring?.autoSubmitted ? "text-rose-500" : (report.proctoring?.warningCount > 0 ? "text-amber-500" : "text-emerald-500")
                      )}>
                        {report.proctoring ? Math.max(0, 100 - report.proctoring.warningCount * 33.35).toFixed(0) : "100"}%
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">AI calculated index</div>
                    </Card>

                    <Card className="p-5 bg-card border-border shadow-soft">
                      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Active Sensors</div>
                      <div className="text-xl font-extrabold text-primary">
                        4 Enforcements
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">Audio, video, tabs, screen</div>
                    </Card>
                  </div>

                  {/* Violation Timeline Audit Card */}
                  <Card className="p-6 bg-card border border-border shadow-soft rounded-2xl">
                    <h4 className="text-sm font-bold mb-6 text-foreground uppercase tracking-wider flex items-center gap-2">
                      <Activity className="w-4 h-4 text-primary" />
                      Session Security Audit Logs
                    </h4>
                    
                    {!report.proctoring || !report.proctoring.violations || report.proctoring.violations.length === 0 ? (
                      <div className="py-12 text-center text-slate-500 dark:text-slate-450 space-y-3">
                        <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/20 text-emerald-650 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-sm">
                          <CheckCircle className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="font-bold text-foreground">No violations detected</p>
                          <p className="text-xs text-muted-foreground mt-1">The candidate completed the session within secure guidelines.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="relative border-l border-border pl-6 ml-4 space-y-6">
                        {report.proctoring.violations.map((violation: any, idx: number) => {
                          const userFriendlyTypes: Record<string, string> = {
                            'tab-blur': 'Tab Switching (Focus Lost)',
                            'fullscreen-exit': 'Exited Fullscreen Mode',
                            'face-none': 'Face Tracking Lost (No Face Detected)',
                            'face-multiple': 'Multiple Persons in Frame',
                            'voice-loud': 'Acoustic Violation (Loud voice/sound)',
                          };

                          const typeColors: Record<string, string> = {
                            'tab-blur': 'border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-500',
                            'fullscreen-exit': 'border-rose-500 bg-rose-50 dark:bg-rose-950/30 text-rose-500',
                            'face-none': 'border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-500',
                            'face-multiple': 'border-rose-500 bg-rose-50 dark:bg-rose-950/30 text-rose-500',
                            'voice-loud': 'border-indigo-500 bg-indigo-50 dark:bg-slate-950/30 text-primary',
                          };

                          const iconMap: Record<string, React.ReactNode> = {
                            'tab-blur': <AppWindow className="w-3.5 h-3.5" />,
                            'fullscreen-exit': <Activity className="w-3.5 h-3.5" />,
                            'face-none': <UserMinus className="w-3.5 h-3.5" />,
                            'face-multiple': <Users className="w-3.5 h-3.5" />,
                            'voice-loud': <Volume2 className="w-3.5 h-3.5" />,
                          };

                          const detailsMap: Record<string, string> = {
                            'tab-blur': 'Candidate switched focus away from the test dashboard to another application or tab. This poses a high risk of code copy-pasting or search lookup.',
                            'fullscreen-exit': 'Candidate exited fullscreen mode. Access to test queries was restricted until re-entering fullscreen.',
                            'face-none': 'Webcam feedback reported no active face detection for longer than 5 seconds. Indicates leaving seat or covering webcam.',
                            'face-multiple': 'Multiple faces detected in camera view. Indicates external assistance/collaboration.',
                            'voice-loud': 'Continuous vocal noise amplitude exceeded safe limits representing environmental verbal help.',
                          };

                          const friendlyName = userFriendlyTypes[violation.type] || violation.type.toUpperCase();
                          const styleStr = typeColors[violation.type] || 'border-indigo-500 bg-indigo-50 text-primary';
                          const detailsStr = detailsMap[violation.type] || 'Suspicious user pattern logged by the system.';
                          const iconEl = iconMap[violation.type] || <ShieldAlert className="w-3.5 h-3.5" />;

                          const dateStr = violation.timestamp 
                            ? new Date(violation.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                            : 'Unknown Time';

                          return (
                            <div key={idx} className="relative">
                              {/* Dot */}
                              <div className={cn(
                                "absolute -left-[35px] top-1 w-7 h-7 rounded-full border-2 flex items-center justify-center bg-card shadow-sm",
                                styleStr
                              )}>
                                {iconEl}
                              </div>

                              <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 rounded-2xl space-y-2">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <h5 className="font-extrabold text-foreground text-sm">
                                      {friendlyName}
                                    </h5>
                                    <p className="text-xs text-muted-foreground font-bold flex items-center gap-1 mt-0.5">
                                      <Clock className="w-3.5 h-3.5" />
                                      Timestamp: {dateStr}
                                    </p>
                                  </div>
                                  <Badge className={cn(
                                    "border-0 font-extrabold text-[10px] px-2 py-0.5",
                                    violation.warningCount >= 3 
                                      ? "bg-red-100 dark:bg-rose-950/65 text-red-800 dark:text-red-400" 
                                      : "bg-amber-100 dark:bg-amber-955/65 text-amber-800 dark:text-amber-300"
                                  )}>
                                    {violation.warningCount >= 3 ? "Warning 3/3 (Disqualified)" : `Warning ${violation.warningCount}/3`}
                                  </Badge>
                                </div>
                                <p className="text-xs text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
                                  {detailsStr}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>

                  {/* Identity Verification Audit Card */}
                  <Card className="p-6 bg-card border border-border shadow-soft rounded-2xl mt-8">
                    <h4 className="text-sm font-bold mb-6 text-foreground uppercase tracking-wider flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-primary" />
                      Biometric Identity Verification Audit
                    </h4>

                    {!report.verification ? (
                      <div className="py-12 text-center text-slate-500 dark:text-slate-450 space-y-3">
                        <div className="w-12 h-12 rounded-full bg-secondary text-muted-foreground flex items-center justify-center mx-auto shadow-sm">
                          <User className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="font-bold text-foreground">No Identity Verification Data Available</p>
                          <p className="text-xs text-slate-550 dark:text-slate-400 mt-1">This candidate has not undergone biometric identity checks.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Images preview side-by-side */}
                        <div className="space-y-4">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block text-left">Captured Verification Artifacts</span>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <span className="block text-xs font-bold text-muted-foreground text-center">Government ID Photo</span>
                              <div className="relative aspect-[4/3] rounded-xl overflow-hidden border border-border bg-slate-950">
                                <img
                                  src={report.verification.idImageUrl || `/api/interview/${data.id}/verification/id`}
                                  className="w-full h-full object-cover"
                                  alt="Government ID"
                                  onError={(e) => {
                                    (e.target as any).src = "https://placehold.co/400x300?text=ID+Image+Not+Found";
                                  }}
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <span className="block text-xs font-bold text-muted-foreground text-center">Live Selfie Snapshot</span>
                              <div className="relative aspect-[4/3] rounded-xl overflow-hidden border border-border bg-slate-950">
                                <img
                                  src={report.verification.selfieImageUrl || `/api/interview/${data.id}/verification/selfie`}
                                  className="w-full h-full object-cover"
                                  alt="Live Selfie"
                                  onError={(e) => {
                                    (e.target as any).src = "https://placehold.co/400x300?text=Selfie+Not+Found";
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Audit Details */}
                        <div className="space-y-6">
                          <div className="space-y-4">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block text-left">Verification Audit Summary</span>
                            <div className="p-4 rounded-2xl border border-slate-150 dark:border-slate-800 bg-slate-50 dark:bg-slate-955/20 grid grid-cols-2 gap-4">
                              <div>
                                <span className="block text-[10px] text-muted-foreground uppercase font-black tracking-wider">Verification Status</span>
                                <Badge className={cn(
                                   "border-0 font-extrabold text-xs px-3 py-1 rounded-full mt-1.5",
                                   report.verification.status === "verified"
                                     ? "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-850 dark:text-emerald-400"
                                     : report.verification.status === "system_error"
                                       ? "bg-amber-100 dark:bg-amber-955/45 text-amber-850 dark:text-amber-300"
                                       : "bg-rose-100 dark:bg-rose-955/55 text-rose-800 dark:text-rose-400"
                                 )}>
                                   {report.verification.status === "system_error" ? "PENDING REVIEW" : (report.verification.status?.toUpperCase() || (report.verification.matched ? "VERIFIED" : "FAILED"))}
                                 </Badge>
                              </div>
                              <div>
                                <span className="block text-[10px] text-muted-foreground uppercase font-black tracking-wider">Face Match Confidence</span>
                                <div className={cn(
                                  "text-2xl font-black mt-1",
                                  report.verification.matched ? "text-emerald-600 dark:text-emerald-450" : "text-rose-500"
                                )}>
                                  {report.verification.confidence || 0}%
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block text-left">Biometric Match Rationale</span>
                            <div className="p-4 rounded-2xl border border-border bg-indigo-50/15 dark:bg-slate-900/30 text-xs font-semibold leading-relaxed text-muted-foreground">
                              {report.verification.reason || "No detail provided by the matching engine."}
                            </div>
                          </div>

                          {report.verification.verifiedAt && (
                            <div className="text-[10px] text-slate-405 dark:text-slate-500 font-bold flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              Verified At: {new Date(report.verification.verifiedAt).toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </Card>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </motion.div>
  );
}
