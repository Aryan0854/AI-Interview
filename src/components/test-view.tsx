"use client";

import { Button } from "@/components/ui/button";
import { CheckCircle2, RotateCcw, AlertTriangle, Sparkles, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

function ResultsView(props: {
  result: {
    correct: number;
    total: number;
    accuracy_pct: number;
    ai_analysis?: string;
    topic_title: string;
  };
  videoUploadState?: "pending" | "uploading" | "done" | "failed";
  onRetake: () => void;
  onGoDashboard: () => void;
}) {
  const { correct = 0, total = 0, accuracy_pct = 0, ai_analysis, topic_title } = props.result;
  const videoUploadState = props.videoUploadState ?? "done";
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
        <h1 className="text-2xl font-extrabold text-foreground">{topic_title}</h1>
        <p className="text-muted-foreground text-sm font-medium">Test results</p>
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
        <p className={`text-6xl font-extrabold ${accent}`}>{correct} / {total}</p>
        <p className="text-indigo-200 text-sm mt-1.5">{pct}% accuracy</p>
      </motion.div>

      {/* ── analysis ── */}
      {ai_analysis && (
        <div className="rounded-xl bg-indigo-50 dark:bg-slate-900/50 border-2 border-border p-5 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-primary" />
            <p className="text-xs font-bold text-primary uppercase tracking-wider">Insights</p>
          </div>
          <p className="text-sm text-indigo-900 dark:text-slate-200 leading-relaxed whitespace-pre-line font-medium">{ai_analysis}</p>
        </div>
      )}

      {/* ── Video upload status ── */}
      {videoUploadState === "uploading" && (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/80 dark:bg-indigo-950/30 p-4 flex items-center gap-3 text-sm text-indigo-900 dark:text-indigo-200">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <p className="font-medium">Saving proctoring video… Please keep this page open.</p>
        </div>
      )}
      {videoUploadState === "done" && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/80 dark:bg-emerald-950/20 p-4 text-sm text-emerald-800 dark:text-emerald-300 font-medium">
          Proctoring video saved successfully.
        </div>
      )}
      {videoUploadState === "failed" && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          Proctoring video could not be saved. Your score is already recorded — use{" "}
          <strong>Upload Proctoring Video</strong> on your dashboard to add it without retaking the test.
        </div>
      )}

      {/* ── Actions ── */}
      <div className="flex gap-3">
        <Button onClick={props.onRetake} className="flex-1 gap-2 bg-primary hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all font-semibold">
          <RotateCcw className="w-4 h-4" /> Retake
        </Button>
        <Button
          variant="outline"
          className="flex-1 rounded-xl border-border text-indigo-700 dark:text-violet-450 hover:bg-secondary font-semibold"
          onClick={props.onGoDashboard}
          disabled={videoUploadState === "uploading"}
        >
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
        className="bg-card rounded-2xl p-7 max-w-md w-full mx-4 shadow-card space-y-5 border border-border"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-955/20 dark:to-amber-900/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-foreground">Retake this test?</h2>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              Your previous score and attempt history for this session will be overwritten.
              This action cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1 rounded-xl border-border text-primary hover:bg-secondary" onClick={props.onCancel}>
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
