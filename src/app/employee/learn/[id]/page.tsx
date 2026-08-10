"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { BookOpen, Sparkles, ChevronRight, Clock, Zap, Loader2, ArrowLeft, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type DifficultyLevel = "beginner" | "intermediate" | "advanced" | "expert";

interface TopicItem {
  id: string;
  title: string;
  difficulty: DifficultyLevel;
  estimated_minutes: number;
  best_pct?: number;
  attempts?: number;
}

interface ModuleItem {
  id: string;
  title: string;
  topics: TopicItem[];
}

interface SubjectDetail {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  modules: ModuleItem[];
}

const diffColors: Record<DifficultyLevel, string> = {
  beginner:    "bg-emerald-100  text-emerald-700  border-emerald-200",
  intermediate:"bg-blue-100    text-blue-700    border-blue-200",
  advanced:    "bg-amber-100   text-amber-700   border-amber-200",
  expert:      "bg-red-100    text-red-700    border-red-200",
};

// ---------------------------------------------------------------------------
// Hook: fetch a single subject with its full module + topic tree
// ---------------------------------------------------------------------------

function useSubjectDetail(subjectId: string, token: string) {
  const [detail, setDetail] = useState<SubjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const r = await fetch("/api/employee/catalog", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!r.ok) throw new Error("Failed to load catalog.");
        const subjects: any[] = await r.json();
        const found = subjects.find((s) => s.id === subjectId);
        if (!found) throw new Error("Subject not found.");
        if (!cancelled) setDetail(found);
      } catch (e: any) {
        if (!cancelled) setErr(e.message || "Unable to load subject.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [subjectId, token]);

  return { detail, loading, err };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SubjectDetailPage() {
  const params  = useParams();
  const router  = useRouter();
  const subjectId = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [token, setToken] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setToken(window.localStorage.getItem("employee_token") ?? "");
  }, []);

  const { detail, loading, err } = useSubjectDetail(subjectId, token);

  const handleTakeTest = (topicId: string) => async () => {
    setActionError(null);
    try {
      const r = await fetch(`/api/employee/learning/${topicId}/ai-quiz`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error("Failed to start test.");
      const { test_id } = await r.json();
      router.push(`/employee/tests/${test_id}`);
    } catch (e: any) {
      setActionError(e.message || "Failed to start test.");
    }
  };

  // -------------------------------------------------------------------------
  // Render — loading
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="flex items-center gap-3 text-indigo-600"
        >
          <Loader2 className="w-7 h-7 animate-spin" />
          <span className="font-medium">Loading subject…</span>
        </motion.div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render — error
  // -------------------------------------------------------------------------
  if (err || !detail) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center px-4">
        <p className="text-red-600 font-medium">{err || "Subject not found."}</p>
        <Link href="/employee/learn">
          <Button variant="outline" className="mt-4 rounded-xl border-indigo-200 text-indigo-700"><ArrowLeft className="w-4 h-4 mr-1"/> Back to catalog</Button>
        </Link>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render — subject detail
  // -------------------------------------------------------------------------
  const totalTopics = detail.modules.reduce((sum, m) => sum + m.topics.length, 0);

  return (
    <div className="max-w-full mx-auto">

      {actionError && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 px-4 py-3 rounded-2xl flex items-center gap-3.5 shadow-sm animate-fade-in text-xs font-semibold mb-6">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <span className="flex-grow">{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-650 font-bold ml-auto px-1.5 text-xs">✕</button>
        </div>
      )}

      {/* ── Breadcrumb ────────────────────────────────────────────── */}
      <div className="mb-6 flex items-center gap-2 text-sm">
        <Link href="/employee/learn" className="text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-1.5 font-medium">
          <ArrowLeft className="w-3.5 h-3.5" /> All subjects
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-600 font-medium">{detail.title}</span>
      </div>

      {/* ── Subject header ────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border border-border bg-card shadow-soft p-8 mb-8"
      >
        <div className="flex items-start gap-4">
          <div
            className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg shadow-indigo-500/25"
            style={{ backgroundColor: detail.color }}
          >
            <BookOpen className="h-7 w-7" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-extrabold text-foreground leading-tight">{detail.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{detail.description}</p>
            <p className="mt-2 text-xs text-primary dark:text-violet-400 font-semibold">{detail.modules.length} module{detail.modules.length !== 1 ? "s" : ""} · {totalTopics} topics</p>
          </div>
        </div>
      </motion.div>

      {/* ── Modules ───────────────────────────────────────────────── */}
      {detail.modules.map((mod, mIdx) => (
        <motion.div
          key={mod.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: mIdx * 0.1 }}
          className="mb-8"
        >
          <h2 className="text-base font-bold text-foreground mb-3 pb-2 border-b border-border">
            {mod.title}
            <span className="ml-2 text-xs font-semibold text-muted-foreground">
              {mod.topics.length} topic{mod.topics.length !== 1 ? "s" : ""}
            </span>
          </h2>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mod.topics.map((topic, tIdx) => (
              <motion.div
                key={topic.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: mIdx * 0.1 + tIdx * 0.05 }}
              >
                <Card
                  className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-foreground leading-snug">{topic.title}</h3>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge variant="outline" className={`text-[10px] border font-semibold ${diffColors[topic.difficulty]}`}>
                          {topic.difficulty}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground border border-border font-medium">
                          <Clock className="w-2.5 h-2.5" /> {topic.estimated_minutes} min
                        </Badge>
                        <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground border border-border font-medium">
                          <BookOpen className="w-2.5 h-2.5" /> 10 MCQs
                        </Badge>
                        {topic.attempts != null && topic.attempts > 0 && (
                          <Badge variant="outline" className="text-[10px] gap-1 text-primary border-border font-semibold bg-indigo-50 dark:bg-slate-950/20">
                            <Zap className="w-2.5 h-2.5" /> Best {topic.best_pct ?? 0}%
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-auto pt-1">
                    <Button
                      size="sm"
                      className="w-full gap-1 bg-primary hover:from-indigo-700 hover:to-violet-700 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all"
                      onClick={handleTakeTest(topic.id)}
                    >
                      <Sparkles className="w-3 h-3" /> Take test →
                    </Button>
                  </div>
                </Card>
              </motion.div>
            ))}

            {mod.topics.length === 0 && (
              <p className="text-sm text-slate-500 font-medium col-span-full">No topics in this module yet.</p>
            )}
          </div>
        </motion.div>
      ))}

    </div>
  );
}
