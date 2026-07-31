"use client";

import { Button } from "@/components/ui/button";
import { CheckCircle2, RotateCcw, AlertTriangle, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

function ResultsView(props: {
  result: {
    correct: number;
    total: number;
    accuracy_pct: number;
    ai_analysis?: { summary?: string; strengths?: string[]; weaknesses?: string[]; next_steps?: string[]; continue_message?: string } | string;
    topic_title: string;
  };
  onRetake: () => void;
  onGoDashboard: () => void;
}) {
  const { correct = 0, total = 0, accuracy_pct = 0, ai_analysis, topic_title } = props.result;
  const analysis = typeof ai_analysis === "string" ? { summary: ai_analysis } : ai_analysis;
  const pct = accuracy_pct;
  const accent = pct >= 75
    ? "text-emerald-600"
    : pct >= 50
      ? "text-amber-600"
      : "text-red-500";

  return (
    <div className="space-y-8 py-6 max-w-xl mx-auto">
      {/* ── Header ── */}
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">{topic_title}</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Test results</p>
      </div>

      {/* ── Score card ── */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="rounded-2xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 text-white p-8 text-center shadow-lg shadow-indigo-500/30 relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-24 h-24 bg-white rounded-full -translate-y-1/2 translate-x-1/3 blur-2xl opacity-10 pointer-events-none" />
        <p className="text-indigo-200 uppercase tracking-[0.2em] text-[10px] font-bold mb-2">Your Score</p>
        <p className={`text-6xl font-extrabold ${accent}`}>{pct}%</p>
        <p className="text-indigo-200 text-sm mt-1.5">{correct} / {total} correct answers</p>
      </motion.div>

      {/* ── analysis ── */}
      {analysis && (analysis.summary || analysis.strengths?.length || analysis.weaknesses?.length) && (
        <div className="rounded-xl bg-indigo-50 dark:bg-slate-900/50 border-2 border-indigo-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            <p className="text-xs font-bold text-indigo-700 dark:text-violet-400 uppercase tracking-wider">Insights</p>
          </div>
          {analysis.summary && (
            <p className="text-sm text-indigo-900 dark:text-slate-200 leading-relaxed font-medium">{analysis.summary}</p>
          )}
          {!!analysis.strengths?.length && (
            <div>
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400 mb-1">Strengths</p>
              <ul className="text-sm text-indigo-900 dark:text-slate-300 space-y-1 list-disc list-inside">
                {analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {!!analysis.weaknesses?.length && (
            <div>
              <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-1">Areas to improve</p>
              <ul className="text-sm text-indigo-900 dark:text-slate-300 space-y-1 list-disc list-inside">
                {analysis.weaknesses.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {!!analysis.next_steps?.length && (
            <div>
              <p className="text-xs font-bold text-indigo-700 dark:text-violet-400 mb-1">Next steps</p>
              <ul className="text-sm text-indigo-900 dark:text-slate-300 space-y-1 list-disc list-inside">
                {analysis.next_steps.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {analysis.continue_message && (
            <p className="text-sm text-indigo-700 dark:text-violet-400 italic pt-1 border-t border-indigo-200 dark:border-slate-800">{analysis.continue_message}</p>
          )}
        </div>
      )}

      {/* ── Actions ── */}
      <div className="flex gap-3">
        <Button onClick={props.onRetake} className="flex-1 gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all font-semibold">
          <RotateCcw className="w-4 h-4" /> Retake
        </Button>
        <Button variant="outline" className="flex-1 rounded-xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-450 hover:bg-indigo-50 dark:hover:bg-slate-800 font-semibold" onClick={props.onGoDashboard}>
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
}

function ConfirmModal(props: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-indigo-900/80 backdrop-blur-sm" role="dialog">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="bg-white dark:bg-slate-900 rounded-2xl p-7 max-w-md w-full mx-4 shadow-card space-y-5 border border-indigo-100 dark:border-slate-800"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-955/20 dark:to-amber-900/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-slate-100">Retake this test?</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Your previous score and attempt history for this session will be overwritten.
              This action cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1 rounded-xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button className="flex-1 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white gap-1 rounded-xl shadow-md shadow-red-500/25 hover:shadow-lg hover:shadow-red-500/35 transition-all font-semibold" onClick={props.onConfirm}>
            <RotateCcw className="w-3.5 h-3.5" /> Continue retake
          </Button>
        </div>
      </motion.div>
      {/* Backdrop click cancels */}
      <button aria-hidden className="absolute inset-0" onClick={props.onCancel} />
    </div>
  );
}

export { ResultsView, ConfirmModal };
