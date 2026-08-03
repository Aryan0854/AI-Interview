/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ResultsView, ConfirmModal } from "@/components/test-view";
import { CheckCircle2, Clock, Flag, XCircle, Zap, ArrowRight, RotateCcw, HelpCircle,
  Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Test, TestQuestion } from "@/types/learning";
import { useEmployeeProctoring, isFullscreenActive } from "@/hooks/useEmployeeProctoring";
import type { EmployeeProctoringState } from "@/lib/employee-proctoring";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_TIME_LIMIT_SECONDS = 1800;
const MIN_RECORDING_BYTES = 4096;

async function validateRecordingBlob(blob: Blob): Promise<boolean> {
  if (blob.size < MIN_RECORDING_BYTES) return false;
  try {
    const sample = new Uint8Array(
      await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer()
    );
    if (
      sample[0] !== 0x1a ||
      sample[1] !== 0x45 ||
      sample[2] !== 0xdf ||
      sample[3] !== 0xa3
    ) {
      return false;
    }
    const cluster = [0x1f, 0x43, 0xb6, 0x75];
    for (let i = 0; i <= sample.length - 4; i++) {
      if (
        sample[i] === cluster[0] &&
        sample[i + 1] === cluster[1] &&
        sample[i + 2] === cluster[2] &&
        sample[i + 3] === cluster[3]
      ) {
        return true;
      }
    }
    return blob.size >= MIN_RECORDING_BYTES * 8;
  } catch {
    return false;
  }
}

async function flushRecorderAndStop(recorder: MediaRecorder): Promise<void> {
  await new Promise<void>((resolve) => {
    if (recorder.state !== "recording") {
      resolve();
      return;
    }
    const onData = () => {
      recorder.removeEventListener("dataavailable", onData);
      resolve();
    };
    recorder.addEventListener("dataavailable", onData);
    try {
      recorder.requestData();
    } catch {
      recorder.removeEventListener("dataavailable", onData);
      resolve();
    }
    setTimeout(() => {
      recorder.removeEventListener("dataavailable", onData);
      resolve();
    }, 2500);
  });

  await new Promise<void>((resolve) => {
    if (recorder.state === "inactive") {
      resolve();
      return;
    }
    recorder.addEventListener("stop", () => resolve(), { once: true });
    try {
      recorder.stop();
    } catch {
      resolve();
    }
  });
}

function createMediaRecorder(stream: MediaStream): MediaRecorder | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;
  // Prefer VP8 — more compatible than VP9 for Chrome/Edge playback after download.
  const mimeTypes = [
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/webm;codecs=vp9",
  ];
  for (const type of mimeTypes) {
    if (MediaRecorder.isTypeSupported?.(type)) {
      return new MediaRecorder(stream, {
        mimeType: type,
        videoBitsPerSecond: 600_000,
      });
    }
  }
  try {
    return new MediaRecorder(stream, { videoBitsPerSecond: 600_000 });
  } catch {
    return null;
  }
}

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

// ── Finish button — disabled until all questions answered ───────────────

function ConfettiButton({ quizDone, onClick }: { quizDone: boolean; onClick?: () => void }) {
  if (!quizDone) {
    return (
      <Button disabled className="gap-1 bg-indigo-100 text-indigo-300 cursor-not-allowed" title="Finish test">
        <HelpCircle className="w-4 h-4" /> Finish
      </Button>
    );
  }

  return (
    <Button onClick={onClick} className="gap-1 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-md shadow-emerald-500/25">
      <CheckCircle2 className="w-4 h-4" /> Finish
    </Button>
  );
}

// =====================================================================
// CLIENT SUB-COMPONENT
// =====================================================================

export default function TestRunnerClient({ testId }: { testId: string }) {
  const router = useRouter();

  // ── state ──────────────────────────────────────────────────────
  type Phase = "loading" | "ready" | "running" | "retake-confirm" | "submitted" | "error";

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
          throw new Error("Failed to load test");
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
  const handleSubmitRef = useRef<(ans: Record<number, number>) => void>(() => {});

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Auto-submit when time expires
  useEffect(() => {
    if (timeLeft === 0 && phase === "running") {
      handleSubmitRef.current(answersRef.current);
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

  const stopRecordingAndUpload = useCallback(async (): Promise<boolean> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      console.warn("Proctoring recorder was not active at submit time.");
      return false;
    }

    const uploadBlob = async (blob: Blob): Promise<boolean> => {
      if (blob.size <= 0 || !token) return false;

      const authHeaders = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      // Production: direct upload to Supabase Storage (serverless-safe)
      try {
        const urlRes = await fetch(`/api/employee/tests/${testId}/video-upload-url`, {
          method: "POST",
          headers: authHeaders,
        });
        if (urlRes.ok) {
          const { signedUrl } = await urlRes.json();
          if (signedUrl) {
            const putRes = await fetch(signedUrl, {
              method: "PUT",
              headers: {
                "Content-Type": "video/webm",
                "Cache-Control": "3600",
              },
              body: blob,
            });
            if (putRes.ok) {
              const completeRes = await fetch(`/api/employee/tests/${testId}/upload_video`, {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({ complete: true }),
              });
              if (completeRes.ok) {
                const payload = await completeRes.json().catch(() => ({}));
                return Boolean(payload?.success);
              }
            }
          }
        }
      } catch (directErr) {
        console.warn("Direct Supabase video upload failed, trying chunk fallback:", directErr);
      }

      // Fallback: server upload (works when under platform body limit)
      if (blob.size <= 4 * 1024 * 1024) {
        try {
          const formData = new FormData();
          formData.append(
            "video",
            new File([blob], `${testId}.webm`, { type: "video/webm" })
          );
          const res = await fetch(`/api/employee/tests/${testId}/upload_video`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          });
          if (res.ok) {
            const payload = await res.json().catch(() => ({}));
            return Boolean(payload?.success);
          }
        } catch {
          // fall through to chunk path
        }
      }

      // Fallback: chunked server upload
      const CHUNK_SIZE = 2 * 1024 * 1024;
      const totalChunks = Math.max(1, Math.ceil(blob.size / CHUNK_SIZE));

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const slice = blob.slice(
          chunkIndex * CHUNK_SIZE,
          Math.min(blob.size, (chunkIndex + 1) * CHUNK_SIZE)
        );
        const formData = new FormData();
        formData.append("chunkIndex", String(chunkIndex));
        formData.append("totalChunks", String(totalChunks));
        formData.append(
          "chunk",
          new File([slice], `${testId}-chunk-${chunkIndex}.webm`, {
            type: blob.type || "video/webm",
          })
        );

        const res = await fetch(`/api/employee/tests/${testId}/upload_video/chunk`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (!res.ok) {
          console.warn("Video chunk upload failed:", await res.text().catch(() => ""));
          return false;
        }

        const payload = await res.json().catch(() => ({}));
        if (payload?.complete && payload?.success) {
          return true;
        }
      }

      return false;
    };

    return new Promise<boolean>((resolve) => {
      intentionalRecorderStopRef.current = true;
      recorder.onstop = async () => {
        try {
          const blob = new Blob(recordingChunksRef.current, {
            type: recorder.mimeType || "video/webm;codecs=vp8",
          });
          if (blob.size <= 0) {
            console.warn("Proctoring recording blob is empty.");
            resolve(false);
            return;
          }
          if (!(await validateRecordingBlob(blob))) {
            console.warn(`Proctoring recording failed validation (${blob.size} bytes).`);
            resolve(false);
            return;
          }

          let ok = await uploadBlob(blob);
          if (!ok) {
            await new Promise((r) => setTimeout(r, 1000));
            ok = await uploadBlob(blob);
          }
          resolve(ok);
        } catch (err) {
          console.warn("Failed to upload proctoring video:", err);
          resolve(false);
        }
      };

      void flushRecorderAndStop(recorder).catch(() => resolve(false));
    });
  }, [testId, token]);

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
      setTimeLeft(test.time_limit_seconds ?? DEFAULT_TIME_LIMIT_SECONDS);
    }

    setPhase("running");
    setAwaitingFullscreen(!isFullscreenActive());
  };

  // ── handlers ───────────────────────────────────────────────────
  const currentQ = questions?.[currentIdx] ?? null;
  const hasPrevious = currentIdx > 0;
  const hasNext     = currentIdx < (questions?.length ?? 0) - 1;

  async function handleSubmit(ans: Record<number, number>, opts?: { autoSubmitted?: boolean }) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setMsg("Submitting…");
    try {
      await stopRecordingAndUpload();
      if (camStream) {
        camStream.getTracks().forEach((track) => track.stop());
      }

      const responseList = Object.entries(ans).map(([qIdx, selected]) => ({
        question_id: questions![parseInt(qIdx)].id,
        selected_index: selected,
        time_seconds: 0,
      }));

      const r = await fetch(`/api/employee/tests/${testId}/submit`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          answers: responseList,
          autoSubmitted: opts?.autoSubmitted === true || warningCount >= 3,
        }),
      });

      if (!r.ok) {
        const errorText = await r.text();
        throw new Error(errorText || "Submit failed");
      }

      const res = await r.json();
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

  if (!currentQ) {
    return (
      <div className="py-24 mx-auto max-w-xl text-center text-slate-500 space-y-4">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
        <p className="font-medium">Loading questions…</p>
      </div>
    );
  }

  // ── phase: submitted ────────────────────────────────────────────
  if (phase === "submitted" && submitted) {
    return <ResultsView result={submitted} onRetake={() => { setPhase("retake-confirm"); setSubmitted(null); setAnswers({}); setCurrentIdx(0); }} onGoDashboard={() => window.location.href = "/employee/dashboard"} />;
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

  // ── phase: loading ─────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="py-24 mx-auto max-w-xl text-center text-slate-500 space-y-4">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
        <p className="font-medium">Preparing your test…</p>
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
          disabled={!allAnswered}
          onClick={() => handleSubmit(answers)}
        >
          {allAnswered ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
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

        {/* Next / Finish */}
        {hasNext ? (
          <Button className="gap-1 bg-primary hover:from-indigo-700 hover:to-violet-700 text-white shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/30 transition-all rounded-xl" onClick={() => setCurrentIdx((i) => i + 1)}>
            Next <ArrowRight className="w-4 h-4" />
          </Button>
        ) : (
          <ConfettiButton quizDone={allAnswered} onClick={() => handleSubmit(answers)} />
        )}
      </div>

      {/* Message toast */}
      {msg && (
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
