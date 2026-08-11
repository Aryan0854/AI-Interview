/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ResultsView, ConfirmModal } from "@/components/test-view";
import { CheckCircle2, Clock, Flag, XCircle, Zap, ArrowRight, RotateCcw,
  Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Test, TestQuestion } from "@/types/learning";
import { useEmployeeProctoring, isFullscreenActive } from "@/hooks/useEmployeeProctoring";
import type { EmployeeProctoringState } from "@/lib/employee-proctoring";
import {
  createMediaRecorder,
  flushRecorderAndStop,
  uploadProctoringBlob,
  uploadProctoringProgress,
} from "@/lib/proctoring-recorder-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_TIME_LIMIT_SECONDS = 1800;

function durationToLabel(d: number): string {
  const m = Math.floor(d / 60);
  const s = d % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function countdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoadedState {
  test: Test;
  questions: TestQuestion[];
}

// ---------------------------------------------------------------------------
// Inline helpers (pure — no client-only dependencies)
// ---------------------------------------------------------------------------

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = (current / Math.max(1, total)) * 100;
  return (
    <div className="w-full h-2 bg-indigo-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={current} aria-valuemax={total}>
      <div className="h-full bg-primary rounded-full transition-all duration-200" style={{ width: `${pct}%` }} />
    </div>
  );
}

function DifficultyBadge({ d }: { d: string }) {
  const cls =
    d === "easy"      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
  : d === "intermediate" ? "bg-amber-100  text-amber-700  border-amber-200"
  :                        "bg-red-100   text-red-700   border-red-200";
  return <span className={`text-[10px] px-2.5 py-1 rounded-full border ${cls} font-bold uppercase tracking-wider`}>{d}</span>;
}

// =====================================================================
// CLIENT SUB-COMPONENT
// =====================================================================

export default function TestRunnerClient({ testId }: { testId: string }) {
  const router = useRouter();

  // ── state ──────────────────────────────────────────────────────
  type Phase = "loading" | "ready" | "running" | "submitting" | "retake-confirm" | "submitted" | "error";
  type VideoUploadState = "pending" | "uploading" | "done" | "failed";

  const [phase,       setPhase]       = useState<Phase>("loading");
  const [err,         setErr]         = useState<string | null>(null);
  const [test,        setTest]        = useState<Test | null>(null);
  const [questions,   setQuestions]   = useState<TestQuestion[] | null>(null);
  const [currentIdx,  setCurrentIdx]  = useState(0);
  const [flags,       setFlags]       = useState<Set<number>>(new Set());
  const [answers,     setAnswers]     = useState<Record<number, number>>({});
  const [timeLeft,    setTimeLeft]    = useState<number | null>(null);
  const [msg,         setMsg]         = useState<string | null>(null);
  const [submitted,   setSubmitted]   = useState<{ correct: number; total: number; accuracy_pct: number; ai_analysis?: string; topic_title: string } | null>(null);
  const [videoUploadState, setVideoUploadState] = useState<VideoUploadState>("pending");

  const savedRef     = useRef(false);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef   = useRef("");
  const submittingRef = useRef(false);

  const [token,       setToken]       = useState("");
  const [initialProctoring, setInitialProctoring] = useState<EmployeeProctoringState | null>(null);

  const [clmReady, setClmReady] = useState(false);
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [awaitingFullscreen, setAwaitingFullscreen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<number | null>(null);
  const intentionalRecorderStopRef = useRef(false);
  const lastProgressUploadRef = useRef(0);

  useEffect(() => {
    setToken(window.localStorage.getItem("employee_token") ?? "");
  }, []);
  const requestFullscreen = useCallback(async () => {
    try {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if ((docEl as any).mozRequestFullScreen) {
        await (docEl as any).mozRequestFullScreen();
      } else if ((docEl as any).webkitRequestFullscreen) {
        await (docEl as any).webkitRequestFullscreen();
      } else if ((docEl as any).msRequestFullscreen) {
        await (docEl as any).msRequestFullscreen();
      }
      return isFullscreenActive();
    } catch (err) {
      console.warn("Fullscreen request rejected or failed:", err);
      return false;
    }
  }, []);

  useEffect(() => {
    if (phase !== "running" || !awaitingFullscreen) return;
    const syncFullscreen = () => {
      if (isFullscreenActive()) setAwaitingFullscreen(false);
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("webkitfullscreenchange", syncFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("webkitfullscreenchange", syncFullscreen);
    };
  }, [phase, awaitingFullscreen]);

  // Bind camera stream to video element when it becomes available
  useEffect(() => {
    if (phase === "running" && camStream && videoRef.current) {
      videoRef.current.srcObject = camStream;
      videoRef.current.play().catch((e) => console.warn("Failed to play video:", e));
    }
  }, [phase, camStream]);

  // ── fetch test + questions ─────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/employee/tests/${testId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!r.ok) {
          const errBody = await r.text();
          let message = "Failed to load test";
          try {
            const parsed = JSON.parse(errBody);
            message = parsed.error ?? message;
          } catch {
            if (errBody?.trim()) message = errBody;
          }
          throw new Error(message);
        }
        const { test: testData, questions: questionsData } = await r.json();
        if (cancelled) return;
        setTest(testData);
        setQuestions(questionsData);
        if (testData.proctoring) {
          setInitialProctoring(testData.proctoring as EmployeeProctoringState);
        }
        let finalTimeLeft = testData.time_limit_seconds ?? DEFAULT_TIME_LIMIT_SECONDS;
        if (testData.status === "in_progress" && testData.started_at) {
          const startedAtMs = new Date(testData.started_at).getTime();
          const elapsedSeconds = Math.floor((Date.now() - startedAtMs) / 1000);
          finalTimeLeft = Math.max(0, finalTimeLeft - elapsedSeconds);
        }
        setTimeLeft(finalTimeLeft);

        const saved = testData.in_progress as Record<number, number> | null;
        if (saved && typeof saved === "object") {
          setAnswers(saved);
          const lastIdx = Math.max(...Object.keys(saved).map(Number), 0) + 1;
          setCurrentIdx(Math.min(lastIdx, (questionsData ?? []).length - 1));
        }

        if (testData.status === "completed") {
          const total = testData.total_questions ?? questionsData?.length ?? 25;
          const correct = testData.score_correct ?? 0;
          const accuracy =
            testData.score_percent ??
            (total > 0 ? Math.round((correct / total) * 100) : 0);
          setSubmitted({
            correct,
            total,
            accuracy_pct: accuracy,
            topic_title: testData.topic_title ?? "",
          });
          setPhase("submitted");
          return;
        }

        setPhase("ready");
      } catch (e: any) {
        if (!cancelled) {
          setErr(e.message ?? "Failed to load test");
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [testId, token]);

  // ── auto-save progress every 10 s ─────────────────────────────
  useEffect(() => {
    if (phase !== "running" || !token) return;
    timerRef.current = setInterval(async () => {
      if (savedRef.current) return;
      savedRef.current = true;
      try {
        await fetch(`/api/employee/tests/${testId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            in_progress: answers,
            current_question_index: currentIdx,
          }),
        });
      } catch { /* ignore */ }
      savedRef.current = false;
    }, 10_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, answers, currentIdx, token, testId]);

  // ── countdown timer ────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "running" || timeLeft === null || timeLeft <= 0) return;
    const id = setInterval(() => {
      setTimeLeft((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearInterval(id);
  }, [phase, timeLeft]);

  const answersRef = useRef(answers);
  const handleSubmitRef = useRef<
    (ans: Record<number, number>, opts?: { autoSubmitted?: boolean; timeExpired?: boolean }) => void
  >(() => {});

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Auto-submit when time expires
  useEffect(() => {
    if (timeLeft === 0 && phase === "running") {
      handleSubmitRef.current(answersRef.current, { autoSubmitted: true, timeExpired: true });
    }
  }, [timeLeft, phase]);

  useEffect(() => {
    return () => {
      if (camStream) {
        camStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [camStream]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let clmScript: HTMLScriptElement | null = null;
    let modelScript: HTMLScriptElement | null = null;

    const loadScripts = async () => {
      try {
        if ((window as any).clm) {
          setClmReady(true);
          return;
        }

        clmScript = document.createElement("script");
        clmScript.src = "https://cdn.jsdelivr.net/npm/clmtrackr@1.1.2/build/clmtrackr.min.js";
        clmScript.async = true;
        document.body.appendChild(clmScript);
        await new Promise((resolve) => {
          clmScript!.onload = resolve;
        });

        modelScript = document.createElement("script");
        modelScript.src = "https://cdn.jsdelivr.net/npm/clmtrackr@1.1.2/models/model_pca_20_svm.js";
        modelScript.async = true;
        document.body.appendChild(modelScript);
        await new Promise((resolve) => {
          modelScript!.onload = resolve;
        });

        if ((window as any).clm && (window as any).pModel) {
          setClmReady(true);
        }
      } catch (err) {
        console.error("Failed to load clmtrackr scripts from CDN:", err);
      }
    };

    void loadScripts();

    return () => {
      if (clmScript && document.body.contains(clmScript)) {
        try {
          document.body.removeChild(clmScript);
        } catch {
          /* ignore */
        }
      }
      if (modelScript && document.body.contains(modelScript)) {
        try {
          document.body.removeChild(modelScript);
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  const { warningCount, showProctorWarning, dismissWarning } = useEmployeeProctoring({
    testId,
    token,
    phase,
    answersRef,
    onAutoSubmit: (ans) => handleSubmitRef.current(ans),
    requestFullscreen,
    videoRef,
    camStream,
    mediaRecorderRef,
    clmReady,
    initialProctoring,
    intentionalRecorderStopRef,
  });

  const uploadProgressSnapshot = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!token || !recorder || recordingChunksRef.current.length === 0) return;
    const now = Date.now();
    if (now - lastProgressUploadRef.current < 45000) return;
    lastProgressUploadRef.current = now;
    const blob = new Blob(recordingChunksRef.current, {
      type: recorder.mimeType || "video/webm",
    });
    await uploadProctoringProgress(testId, token, blob).catch(() => {});
  }, [testId, token]);

  const finalizeRecordingBlob = useCallback(async (): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      intentionalRecorderStopRef.current = true;
      try {
        await flushRecorderAndStop(recorder);
      } catch {
        /* use whatever chunks we have */
      }
    }
    if (recordingChunksRef.current.length === 0) return null;
    return new Blob(recordingChunksRef.current, {
      type: recorder?.mimeType || "video/webm",
    });
  }, []);

  const uploadRecordingBlob = useCallback(
    async (blob: Blob): Promise<boolean> => {
      if (blob.size <= 0) return false;
      let ok = await uploadProctoringBlob(testId, token, blob);
      if (!ok) {
        await new Promise((r) => setTimeout(r, 1000));
        ok = await uploadProctoringBlob(testId, token, blob);
      }
      return ok;
    },
    [testId, token]
  );

  const stopRecordingAndUpload = useCallback(async (): Promise<boolean> => {
    try {
      const blob = await finalizeRecordingBlob();
      if (!blob || blob.size <= 0) {
        console.warn("Proctoring recording blob is empty at submit time.");
        return false;
      }
      return uploadRecordingBlob(blob);
    } catch (err) {
      console.warn("Failed to upload proctoring video:", err);
      return false;
    }
  }, [finalizeRecordingBlob, uploadRecordingBlob]);

  const handleStartTest = async () => {
    // Camera permission UI must finish before fullscreen can activate reliably.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      setCamStream(stream);

      const recorder = createMediaRecorder(stream);
      if (!recorder) {
        stream.getTracks().forEach((track) => track.stop());
        console.warn("MediaRecorder unavailable; continuing without video recording.");
      } else {
        mediaRecorderRef.current = recorder;
        recordingChunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data?.size > 0) recordingChunksRef.current.push(event.data);
          void uploadProgressSnapshot();
        };
        // Collect periodic chunks, but always keep every chunk from t=0 so the EBML header is present.
        recorder.start(2000);
        recordingStartRef.current = Date.now();
      }
    } catch (err) {
      console.warn("Failed to access webcam; continuing without camera:", err);
    }

    // Brief pause lets the browser close the camera permission banner before fullscreen.
    await new Promise((resolve) => setTimeout(resolve, 200));
    let enteredFullscreen = await requestFullscreen();
    if (!enteredFullscreen) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      enteredFullscreen = await requestFullscreen();
    }

    // If starting fresh (pending), update status and started_at in backend
    const limit = test?.time_limit_seconds ?? DEFAULT_TIME_LIMIT_SECONDS;
    if (test && test.status === "pending") {
      const startTime = new Date().toISOString();
      try {
        await fetch(`/api/employee/tests/${testId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: "in_progress",
            started_at: startTime,
          }),
        });
      } catch (err) {
        console.warn("Failed to update test start time in database:", err);
      }
      setTimeLeft(limit);
    } else if (test && test.status === "in_progress") {
      const remaining = timeLeft ?? limit;
      if (remaining <= 0) {
        const startTime = new Date().toISOString();
        try {
          await fetch(`/api/employee/tests/${testId}`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ started_at: startTime }),
          });
        } catch (err) {
          console.warn("Failed to refresh test timer in database:", err);
        }
        setTimeLeft(limit);
      }
    }

    setPhase("running");
    setAwaitingFullscreen(!isFullscreenActive());
  };

  // ── handlers ───────────────────────────────────────────────────
  const currentQ = questions?.[currentIdx] ?? null;
  const hasPrevious = currentIdx > 0;
  const hasNext     = currentIdx < (questions?.length ?? 0) - 1;

  async function handleSubmit(
    ans: Record<number, number>,
    opts?: { autoSubmitted?: boolean; timeExpired?: boolean }
  ) {
    if (submittingRef.current) return;
    const answerEntries = Object.entries(ans);
    const isAuto = opts?.autoSubmitted === true || opts?.timeExpired === true;
    if (answerEntries.length === 0 && !isAuto) {
      setErr("Please answer at least one question before submitting.");
      return;
    }
    submittingRef.current = true;
    setPhase("submitting");
    setMsg(null);
    try {
      const responseList = answerEntries.map(([qIdx, selected]) => ({
        question_id: questions![parseInt(qIdx)].id,
        selected_index: selected,
        time_seconds: 0,
      }));

      // Stop recorder first so the final WebM blob is complete before upload.
      const recordingBlob = await finalizeRecordingBlob();

      const r = await fetch(`/api/employee/tests/${testId}/submit`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          answers: responseList,
          autoSubmitted: isAuto || warningCount >= 3,
        }),
      });

      if (!r.ok) {
        const errorText = await r.text();
        let message = "Submit failed";
        try {
          const parsed = JSON.parse(errorText);
          message = parsed.error ?? message;
        } catch {
          if (errorText?.trim()) message = errorText;
        }
        throw new Error(message);
      }

      const res = await r.json();
      if (res.alreadyCompleted) {
        setSubmitted({
          correct: res.correct ?? 0,
          total: res.total ?? questions?.length ?? 25,
          accuracy_pct: res.accuracy ?? 0,
          topic_title: (test as any)?.topic_title ?? "",
        });
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        setPhase("submitted");
        setMsg(null);
        setVideoUploadState("done");
        submittingRef.current = false;
        return;
      }
      setSubmitted({
        correct: res.correct,
        total: res.total,
        accuracy_pct: res.accuracy,
        ai_analysis: res.ai_analysis,
        topic_title: (test as any)?.topic_title ?? "",
      });
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      setPhase("submitted");
      setMsg(null);
      setVideoUploadState("uploading");

      const uploaded = recordingBlob
        ? await uploadRecordingBlob(recordingBlob)
        : await stopRecordingAndUpload();
      if (camStream) {
        camStream.getTracks().forEach((track) => track.stop());
      }
      setVideoUploadState(uploaded ? "done" : "failed");
    } catch (e: any) {
      submittingRef.current = false;
      setErr(e.message ?? "Submit failed"); setPhase("error");
    }
  }
  handleSubmitRef.current = handleSubmit;

  function toggleFlag(idx: number) {
    setFlags((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function selectAnswer(qIdx: number, optionIdx: number) {
    setAnswers((prev) => ({ ...prev, [qIdx]: optionIdx }));
  }

  const answeredCount  = Object.keys(answers).length;
  const allAnswered    = questions ? answeredCount >= questions.length : false;

  // ── phase: loading ─────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="py-24 mx-auto max-w-xl text-center text-slate-500 space-y-4">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
        <p className="font-medium">Preparing your test…</p>
      </div>
    );
  }

  if ((phase === "ready" || phase === "running") && (!questions || questions.length === 0)) {
    return (
      <div className="py-16 mx-auto max-w-md text-center space-y-6">
        <XCircle className="w-10 h-10 text-red-500 mx-auto" />
        <p className="text-red-600 font-medium">
          No questions are available for this assessment. Please contact your administrator.
        </p>
        <Button onClick={() => router.push("/employee/dashboard")}>Back to Dashboard</Button>
      </div>
    );
  }

  if (!currentQ && phase === "running") {
    return (
      <div className="py-24 mx-auto max-w-xl text-center text-slate-500 space-y-4">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
        <p className="font-medium">Loading questions…</p>
      </div>
    );
  }

  // ── phase: submitting ───────────────────────────────────────────
  if (phase === "submitting") {
    return (
      <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm px-6">
        <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
        <h2 className="text-lg font-bold text-foreground">Submitting your assessment</h2>
        <p className="text-sm text-muted-foreground mt-2 text-center max-w-sm">
          Saving your answers… Please do not close or refresh this page.
        </p>
      </div>
    );
  }

  // ── phase: submitted ────────────────────────────────────────────
  if (phase === "submitted" && submitted) {
    return (
      <ResultsView
        result={submitted}
        videoUploadState={videoUploadState}
        onRetake={() => { setPhase("retake-confirm"); setSubmitted(null); setAnswers({}); setCurrentIdx(0); setVideoUploadState("pending"); }}
        onGoDashboard={() => window.location.href = "/employee/dashboard"}
      />
    );
  }

  // ── phase: retake confirm ───────────────────────────────────────
  if (phase === "retake-confirm") {
    return (
      <div className="max-w-xl mx-auto">
        <ConfirmModal
          onConfirm={async () => {
            try {
              const res = await fetch(`/api/employee/tests/${testId}`, {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              });
              if (res.ok) {
                window.location.reload();
                return;
              }
            } catch (err) {
              console.error("Failed to reset test:", err);
            }
            setPhase("running");
            setAnswers({}); setCurrentIdx(0); setFlags(new Set()); setErr(null); setMsg(null);
          }}
          onCancel={() => setPhase("submitted")}
        />
      </div>
    );
  }

  // ── phase: error ────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <div className="py-16 mx-auto max-w-md text-center space-y-6">
        <XCircle className="w-10 h-10 text-red-500 mx-auto" />
        <p className="text-red-600 font-medium">{err}</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  // ── phase: ready ────────────────────────────────────────────────
  if (phase === "ready") {
    return (
      <div className="max-w-2xl mx-auto py-16 px-4 space-y-8 text-center bg-card border border-border rounded-3xl shadow-soft p-10 animate-fade-in mt-10">
        <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/25 animate-pulse">
          <AlertTriangle className="w-8 h-8 text-white" />
        </div>
        <div className="space-y-3">
          <h1 className="text-2xl font-black text-foreground">
            {test?.status === "in_progress" ? "Resume Assessment" : "Active Proctoring & Integrity Agreement"}
          </h1>
          <p className="text-sm text-muted-foreground font-semibold max-w-md mx-auto leading-relaxed">
            {test?.status === "in_progress"
              ? "Re-enter the assessment window. Allow fullscreen and camera if prompted for stronger proctoring."
              : "Camera and fullscreen are recommended for proctoring. You can still start if either is unavailable. Tab switching and other integrity checks still apply."}
          </p>
        </div>

        <div className="bg-slate-50 dark:bg-slate-950 p-6 rounded-2xl border border-slate-100 dark:border-slate-900/60 max-w-md mx-auto text-left space-y-4">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-850 dark:text-slate-200">Rules &amp; Guidelines:</h3>
          <ul className="text-xs font-semibold text-muted-foreground space-y-2 list-disc list-inside">
            <li>
              Use <span className="text-foreground font-bold">Google Chrome</span> or{" "}
              <span className="text-foreground font-bold">Microsoft Edge</span> only. Safari/Firefox may fail recording.
            </li>
            <li>
              Allow <span className="text-foreground font-bold">webcam</span> when prompted. Camera and fullscreen are
              recommended for proctoring; you can still start if either is unavailable.
            </li>
            <li>
              Face monitoring is active: looking away/down, missing face, or multiple people in frame are flagged with timestamps.
            </li>
            <li>Tab switch, minimize, refresh, copy/paste, and DevTools are blocked.</li>
            <li>Session may be video-recorded when camera access is granted.</li>
            <li>5 strikes auto-submits your assessment.</li>
          </ul>
        </div>

        <Button
          onClick={handleStartTest}
          size="lg"
          className="w-full max-w-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-md h-12 gap-2"
        >
          {test?.status === "in_progress" ? "Resume Assessment" : "Start Assessment"}{" "}
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // RENDER: active test runner
  // ─────────────────────────────────────────────────────────────────

  const isFlagged  = flags.has(currentIdx);
  const selected   = answers[currentIdx];

  return (
    <div className={`max-w-3xl mx-auto px-4 py-6 space-y-6 ${phase === "running" ? "select-none" : ""} ${showProctorWarning || awaitingFullscreen ? "pointer-events-none" : ""}`}>

      {/* ── Header bar ──────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <DifficultyBadge d={(currentQ as any).difficulty ?? "medium"} />
          <span>·</span>
          <span>
            Question {currentIdx + 1} / {questions!.length}
          </span>
          <span>·</span>
          <span className={timeLeft !== null && timeLeft < 60 ? "text-red-500 font-bold" : ""}>
            <Clock className="inline w-3.5 h-3.5 mr-1 align-middle" />
            {timeLeft !== null ? countdown(timeLeft) : "∞"}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className={`gap-1.5 rounded-lg border ${allAnswered ? "border-indigo-500 dark:border-indigo-700 text-primary bg-indigo-50 dark:bg-slate-900 font-semibold" : "border-border text-muted-foreground hover:bg-secondary"}`}
          disabled={!allAnswered || submittingRef.current}
          onClick={() => handleSubmit(answers)}
        >
          {submittingRef.current ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : allAnswered ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          )}
          Submit
        </Button>
      </header>

      {/* ── Progress bar ─────────────────────────────────────────── */}
      <ProgressBar current={currentIdx} total={questions!.length} />

      {/* ── Question card ────────────────────────────────────────── */}
      <div className="rounded-2xl bg-card shadow-soft border border-border p-8 space-y-5">

        {/* flag */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-primary dark:text-violet-450 uppercase tracking-wider">
              <span className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-505 to-violet-600 flex items-center justify-center text-white text-[10px]">{currentIdx + 1}</span>
              Q{currentIdx + 1}
            </span>
          </div>
          <button
            onClick={() => toggleFlag(currentIdx)}
            className={`p-1.5 rounded-lg transition-all duration-200 ${
              isFlagged
                ? "bg-amber-100 dark:bg-amber-950/35 text-amber-600 dark:text-amber-400 shadow-sm shadow-amber-500/15"
                : "text-slate-300 dark:text-slate-600 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-slate-800"
            }`}
            title={isFlagged ? "Remove flag" : "Flag for review"}
          >
            <Flag className="w-4 h-4" fill={isFlagged ? "currentColor" : "none"} />
          </button>
        </div>

        {/* question text */}
        <h2 className="text-lg font-bold leading-snug text-foreground">
          {(currentQ as any).question_text}
        </h2>

        {/* option buttons */}
        <div className="space-y-3">
          {(currentQ as any).options.map((option: string, i: number) => {
            const isSelected = selected === i;
            return (
              <button
                key={i}
                onClick={() => selectAnswer(currentIdx, i)}
                className={`
                  w-full text-left px-5 py-4 rounded-xl border-2 text-sm font-medium transition-all duration-200
                  ${isSelected
                    ? "border-indigo-500 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-900 dark:text-indigo-200 shadow-md shadow-indigo-500/15 ring-2 ring-indigo-200 dark:ring-indigo-800"
                    : "border-border hover:border-indigo-400 dark:hover:border-indigo-600 hover:bg-indigo-50/50 dark:hover:bg-slate-800 text-muted-foreground"
                  }
                `}
                aria-pressed={isSelected}
              >
                <span className="inline-flex items-center gap-3">
                  <span className={`
                    w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-extrabold transition-all
                    ${isSelected ? "border-indigo-500 bg-indigo-500 text-white shadow-md shadow-indigo-500/25" : "border-indigo-200 dark:border-slate-700 text-indigo-400 dark:text-violet-400"}
                  `}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  {option}
                </span>
              </button>
            );
          })}
        </div>

      </div>

      {/* ── Navigation footer ──────────────────────────────────── */}
      <div className="flex items-center justify-between">

        {/* Previous */}
        <Button
          variant="outline"
          className="rounded-xl border-border text-primary hover:bg-secondary font-semibold"
          onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
          disabled={!hasPrevious}
        >
          ← Previous
        </Button>

        {/* Overview: dots */}
        <div className="flex flex-wrap justify-center items-center gap-1.5" role="list" aria-label="Question overview">
          {questions!.map((q, i) => {
            const answered   = answers[i] !== undefined;
            const flagged    = flags.has(i);
            const current    = i === currentIdx;
            let cls = "w-8 h-8 rounded-full border-2 flex items-center justify-center text-[10px] font-extrabold transition-all duration-150 ";
            if (current)    cls += "border-indigo-500 bg-indigo-500 text-white ring-2 ring-indigo-200 dark:ring-indigo-800 scale-110 shadow-md";
            else if (answered && flagged) cls += "border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-450";
            else if (answered)            cls += "border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-450";
            else if (flagged)             cls += "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 text-amber-505 dark:text-amber-450";
            else                          cls += "border-border bg-card text-indigo-300 dark:text-slate-600";
            return (
              <button
                key={i}
                role="listitem"
                aria-label={`Question ${i + 1}${answered ? ` (answered)` : ""}${flagged ? " (flagged)" : ""}`}
                className={cls}
                onClick={() => setCurrentIdx(i)}
              >
                {flagged ? <Flag className="w-3 h-3" fill="currentColor" /> : i + 1}
              </button>
            );
          })}
        </div>

        {/* Next — submit is only via the header button */}
        {hasNext ? (
          <Button className="gap-1 bg-primary hover:from-indigo-700 hover:to-violet-700 text-white shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/30 transition-all rounded-xl" onClick={() => setCurrentIdx((i) => i + 1)}>
            Next <ArrowRight className="w-4 h-4" />
          </Button>
        ) : (
          <div className="w-[88px]" aria-hidden="true" />
        )}
      </div>

      {/* Message toast (non-submit notices) */}
      {msg && phase === "running" && (
        <div className="text-center">
          <p className="text-sm text-slate-500 italic">{msg}</p>
        </div>
      )}

      {/* Fullscreen gate — shown when camera permission blocked initial fullscreen */}
      {awaitingFullscreen && phase === "running" && !showProctorWarning && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 pointer-events-auto">
          <div className="bg-card rounded-2xl shadow-xl max-w-md w-full p-6 border border-indigo-100 dark:border-indigo-950/30 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-950/30 flex items-center justify-center mx-auto text-indigo-600 dark:text-indigo-400">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-foreground">Enter Fullscreen to Begin</h3>
            <p className="text-sm text-muted-foreground">
              This assessment runs in fullscreen. Click below after allowing camera access.
            </p>
            <Button
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-3 font-semibold text-sm"
              onClick={async () => {
                const ok = await requestFullscreen();
                if (ok || isFullscreenActive()) {
                  setAwaitingFullscreen(false);
                }
              }}
            >
              Enter Fullscreen &amp; Continue
            </Button>
          </div>
        </div>
      )}

      {/* Security Warning Modal Overlay */}
      {showProctorWarning && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 pointer-events-auto">
          <div className="bg-card rounded-2xl shadow-xl max-w-md w-full p-6 border border-red-100 dark:border-red-950/30 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center mx-auto text-red-600 dark:text-red-400 animate-pulse">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-foreground">Security Warning</h3>
            <p className="text-sm text-muted-foreground">
              {showProctorWarning}
            </p>
            <div className="bg-red-50 dark:bg-red-950/20 py-2 px-4 rounded-xl text-xs font-bold text-red-700 dark:text-rose-400 inline-block">
              Warning Strike: {warningCount} / 3
            </div>
            <p className="text-xs text-slate-400">
              Note: Reaching 5 strikes will automatically submit your assessment.
            </p>
            {warningCount >= 3 ? (
              <Button
                disabled
                className="w-full bg-red-600 text-white rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2"
              >
                <Loader2 className="w-4 h-4 animate-spin" /> Submitting Assessment...
              </Button>
            ) : (
              <Button
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-3 font-semibold text-sm"
                onClick={() => void dismissWarning()}
              >
                Understand & Continue
              </Button>
            )}
          </div>
        </div>
      )}
      {/* Floating webcam proctoring box */}
      {phase === "running" && (
        <div className="fixed bottom-6 right-6 w-44 h-32 rounded-2xl overflow-hidden border-2 border-indigo-500 shadow-xl bg-slate-950 z-50">
          <video
            ref={videoRef}
            muted
            playsInline
            className="w-full h-full object-cover transform -scale-x-100"
          />
          <div className="absolute bottom-2 left-2 bg-red-600/90 text-white text-[9px] font-black tracking-widest px-2 py-0.5 rounded uppercase flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
            Live Proctor
          </div>
        </div>
      )}

    </div>
  );
}
