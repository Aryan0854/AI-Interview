/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ResultsView, ConfirmModal } from "@/components/test-view";
import { CheckCircle2, Clock, Flag, XCircle, Zap, ArrowRight, RotateCcw, HelpCircle,
  Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Test, TestQuestion } from "@/types/learning";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_TIME_LIMIT_SECONDS = 1800;

function createMediaRecorder(stream: MediaStream): MediaRecorder | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;
  const mimeTypes = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const type of mimeTypes) {
    if (MediaRecorder.isTypeSupported?.(type)) {
      return new MediaRecorder(stream, {
        mimeType: type,
        videoBitsPerSecond: 400_000,
      });
    }
  }
  try {
    return new MediaRecorder(stream, { videoBitsPerSecond: 400_000 });
  } catch {
    return null;
  }
}

function isFullscreenActive(): boolean {
  return !!(
    document.fullscreenElement ||
    (document as any).webkitFullscreenElement ||
    (document as any).mozFullScreenElement
  );
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
  
  // New proctoring states
  const [warningCount, setWarningCount] = useState(0);
  const [showProctorWarning, setShowProctorWarning] = useState<string | null>(null);
  const lastTriggerRef = useRef(0);

  const [clmReady, setClmReady] = useState(false);
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<number | null>(null);

  useEffect(() => {
    setToken(window.localStorage.getItem("employee_token") ?? "");
  }, []);

  // Helper to request fullscreen
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
    } catch (err) {
      console.warn("Fullscreen request rejected or failed:", err);
    }
  }, []);

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

  // ── proctoring logic and refs ──────────────────────────────────
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Auto-submit when time is expired
  useEffect(() => {
    if (timeLeft === 0 && phase === "running") {
      handleSubmit(answersRef.current);
    }
  }, [timeLeft, phase]);

  // Stop webcam tracks on unmount or phase change
  useEffect(() => {
    return () => {
      if (camStream) {
        camStream.getTracks().forEach(t => t.stop());
      }
    };
  }, [camStream]);

  // Dynamic Loading of clmtrackr scripts from CDN
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let clmScript: HTMLScriptElement | null = null;
    let modelScript: HTMLScriptElement | null = null;

    const loadScripts = async () => {
      try {
        if ((window as any).clm) {
          setClmReady(true);
          return;
        }

        clmScript = document.createElement('script');
        clmScript.src = 'https://cdn.jsdelivr.net/npm/clmtrackr@1.1.2/build/clmtrackr.min.js';
        clmScript.async = true;
        document.body.appendChild(clmScript);

        await new Promise((resolve) => {
          clmScript!.onload = resolve;
        });

        modelScript = document.createElement('script');
        modelScript.src = 'https://cdn.jsdelivr.net/npm/clmtrackr@1.1.2/models/model_pca_20_svm.js';
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

    loadScripts();

    return () => {
      if (clmScript && document.body.contains(clmScript)) {
        try { document.body.removeChild(clmScript); } catch(e){}
      }
      if (modelScript && document.body.contains(modelScript)) {
        try { document.body.removeChild(modelScript); } catch(e){}
      }
    };
  }, []);

  const persistProctorViolation = useCallback(async (violationType: string, count: number, autoSubmitted = false) => {
    if (!token) return;
    try {
      await fetch(`/api/employee/tests/${testId}/proctor_violation`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ violationType, warningCount: count, autoSubmitted }),
      });
    } catch (err) {
      console.warn("Failed to persist proctor violation:", err);
    }
  }, [testId, token]);

  const triggerProctorWarning = useCallback((violationType: string) => {
    if (phase !== "running") return;

    // 3-second cooldown to avoid duplicate triggers
    const nowMs = Date.now();
    if (nowMs - lastTriggerRef.current < 3000) return;
    lastTriggerRef.current = nowMs;

    setWarningCount((prev) => {
      if (prev >= 3) return prev;

      const nextCount = prev + 1;
      void persistProctorViolation(violationType, nextCount, nextCount >= 3);
      let msgText = "";
      if (nextCount >= 3) {
        msgText = "You have exceeded the maximum of 3 security violations. Your assessment is being automatically submitted.";
      } else if (violationType === "Tab Switch Detected") {
        msgText = "You switched browser tabs. This is prohibited during the test.";
      } else if (violationType === "Window Lost Focus") {
        msgText = "You left the test window or opened another app.";
      } else if (violationType === "Right Click Attempted") {
        msgText = "Right-clicking and inspecting elements is strictly disabled.";
      } else if (violationType === "DevTools Shortcut Blocked") {
        msgText = "Developer tools shortcuts are blocked.";
      } else if (violationType === "Copy/Paste Attempted") {
        msgText = "Copying or pasting text is strictly disabled.";
      } else if (violationType === "Fullscreen Mode Exited") {
        msgText = "You exited fullscreen mode. Please remain in fullscreen during the test.";
      } else if (violationType === "Face Missing") {
        msgText = "Face not detected in camera feed. Please face your screen clearly.";
      } else if (violationType.startsWith("Looking")) {
        msgText = `Please look directly at your screen. (Violation: ${violationType})`;
      } else {
        msgText = `A security violation (${violationType}) was flagged.`;
      }

      setShowProctorWarning(msgText);

      if (nextCount >= 3) {
        setTimeout(() => {
          setShowProctorWarning(null);
          handleSubmit(answersRef.current);
        }, 1500);
      }

      return nextCount;
    });
  }, [phase, persistProctorViolation]);

  // Active proctoring event listeners
  useEffect(() => {
    if (phase !== "running") return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        triggerProctorWarning("Tab Switch Detected");
      }
    };

    const handleWindowBlur = () => {
      triggerProctorWarning("Window Lost Focus");
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      triggerProctorWarning("Right Click Attempted");
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;
      const isF12 = e.key === 'F12' || e.keyCode === 123;
      const isDevToolsShortcut = 
        (isCmdOrCtrl && isShift && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c' || e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) ||
        (isCmdOrCtrl && (e.key === 'U' || e.key === 'u' || e.keyCode === 85)) ||
        (isCmdOrCtrl && (e.key === 'S' || e.key === 's' || e.keyCode === 83));

      if (isF12 || isDevToolsShortcut) {
        e.preventDefault();
        e.stopPropagation();
        triggerProctorWarning("DevTools Shortcut Blocked");
      }
    };

    const handleCopyCutPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      triggerProctorWarning("Copy/Paste Attempted");
    };

    const handleSelectStart = (e: Event) => {
      e.preventDefault();
    };

    const handleFullscreenChange = () => {
      const isFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      if (!isFullscreen) {
        triggerProctorWarning("Fullscreen Mode Exited");
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('copy', handleCopyCutPaste);
    document.addEventListener('cut', handleCopyCutPaste);
    document.addEventListener('paste', handleCopyCutPaste);
    document.addEventListener('selectstart', handleSelectStart);

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('copy', handleCopyCutPaste);
      document.removeEventListener('cut', handleCopyCutPaste);
      document.removeEventListener('paste', handleCopyCutPaste);
      document.removeEventListener('selectstart', handleSelectStart);

      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, [phase, triggerProctorWarning]);

  // Face and gaze tracking loop
  useEffect(() => {
    if (phase !== "running" || !clmReady) return;

    let trackerInstance: any = null;
    let intervalId: any = null;
    let lastState: 'one' | 'none' | 'left' | 'right' | 'up' | 'down' = 'one';
    let stateStartTime = Date.now();
    let isTracking = false;

    const stateHistory: string[] = [];

    const startTracking = () => {
      if (!clmReady || !(window as any).clm || !(window as any).pModel) return;
      try {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        trackerInstance = new (window as any).clm.tracker();
        trackerInstance.init((window as any).pModel);
        trackerInstance.start(videoRef.current);
        isTracking = true;
      } catch (err) {
        console.debug("Failed to start clmtrackr:", err);
      }
    };

    const timer = setTimeout(() => {
      startTracking();
    }, 1000);

    intervalId = setInterval(() => {
      if (!clmReady || !isTracking || !trackerInstance || !(window as any).clm || !(window as any).pModel) {
        if (videoRef.current && videoRef.current.readyState >= 2 && !isTracking) {
          startTracking();
        }
        return;
      }

      const positions = trackerInstance.getCurrentPosition();
      const score = trackerInstance.getScore();

      let detectedState: typeof lastState = 'one';

      if (!positions || positions.length < 70 || score < 0.35) {
        detectedState = 'none';
      } else {
        const noseX = positions[62][0];
        const noseY = positions[62][1];
        const leftFaceX = positions[1][0];
        const rightFaceX = positions[13][0];
        const noseBridgeY = positions[33][1];
        const chinY = positions[7][1];

        const leftDist = noseX - leftFaceX;
        const rightDist = rightFaceX - noseX;
        const horizontalRatio = leftDist / (rightDist || 1);

        const noseLen = noseY - noseBridgeY;
        const chinLen = chinY - noseY;
        const verticalRatio = noseLen / (chinLen || 1);

        if (horizontalRatio < 0.75) {
          detectedState = 'right';
        } else if (horizontalRatio > 1.30) {
          detectedState = 'left';
        } else if (verticalRatio < 0.45) {
          detectedState = 'up';
        } else if (verticalRatio > 0.85) {
          detectedState = 'down';
        } else {
          detectedState = 'one';
        }
      }

      stateHistory.push(detectedState);
      if (stateHistory.length > 5) {
        stateHistory.shift();
      }

      const counts: Record<string, number> = {};
      let maxCount = 0;
      let smoothedState = detectedState;
      for (const s of stateHistory) {
        counts[s] = (counts[s] || 0) + 1;
        if (counts[s] > maxCount) {
          maxCount = counts[s];
          smoothedState = s as any;
        }
      }

      const now = Date.now();
      if (smoothedState !== lastState) {
        lastState = smoothedState;
        stateStartTime = now;
      } else {
        const duration = (now - stateStartTime) / 1000;
        
        if (lastState === 'none' && duration >= 4.0) {
          triggerProctorWarning("Face Missing");
          stateStartTime = now;
        } else if (['left', 'right', 'up', 'down'].includes(lastState) && duration >= 4.0) {
          let warningMsg = "Looking Away";
          if (lastState === 'down') warningMsg = "Looking Down (possible phone usage)";
          triggerProctorWarning(warningMsg);
          stateStartTime = now;
        }
      }
    }, 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(intervalId);
      if (trackerInstance) {
        try {
          trackerInstance.stop();
        } catch (e) {}
      }
    };
  }, [phase, clmReady, triggerProctorWarning]);

  const stopRecordingAndUpload = useCallback(async (): Promise<boolean> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      console.warn("Proctoring recorder was not active at submit time.");
      return false;
    }

    const uploadBlob = async (blob: Blob): Promise<boolean> => {
      if (blob.size <= 0 || !token) return false;

      const authHeaders = { Authorization: `Bearer ${token}` };
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
          headers: authHeaders,
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

    return await new Promise<boolean>((resolve) => {
      recorder.onstop = async () => {
        try {
          const blob = new Blob(recordingChunksRef.current, {
            type: recorder.mimeType || "video/webm",
          });
          if (blob.size <= 0) {
            console.warn("Proctoring recording blob is empty.");
            resolve(false);
            return;
          }

          let ok = await uploadBlob(blob);
          if (!ok) {
            await new Promise((r) => setTimeout(r, 800));
            ok = await uploadBlob(blob);
          }
          resolve(ok);
        } catch (err) {
          console.warn("Failed to upload proctoring video:", err);
          resolve(false);
        }
      };

      try {
        if (recorder.state === "recording") {
          recorder.requestData();
        }
      } catch {
        // ignore
      }
      recorder.stop();
    });
  }, [testId, token]);

  const handleStartTest = async () => {
    await requestFullscreen();
    if (!isFullscreenActive()) {
      alert("Fullscreen mode is required to start this assessment. Please allow fullscreen and try again.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      setCamStream(stream);

      const recorder = createMediaRecorder(stream);
      if (!recorder) {
        stream.getTracks().forEach((track) => track.stop());
        alert(
          "Could not start proctoring video recording. Please use Chrome or Edge, allow camera access, and try again."
        );
        return;
      }

      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.start(1000);
      recordingStartRef.current = Date.now();
    } catch (err) {
      console.warn("Failed to access webcam:", err);
      alert("Proctoring camera access is required to take this test. Please enable camera access in your browser settings and click Start again.");
      return;
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
  };

  // ── handlers ───────────────────────────────────────────────────
  const currentQ = questions?.[currentIdx] ?? null;
  const hasPrevious = currentIdx > 0;
  const hasNext     = currentIdx < (questions?.length ?? 0) - 1;

  async function handleSubmit(ans: Record<number, number>) {
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
        body: JSON.stringify({ answers: responseList }),
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
              ? "Re-enter the assessment window. Fullscreen mode and camera access will be reactivated."
              : "By proceeding, you agree to grant camera access for real-time face tracking. Exiting fullscreen or switching tabs will trigger violation warnings."}
          </p>
        </div>

        <div className="bg-slate-50 dark:bg-slate-950 p-6 rounded-2xl border border-slate-100 dark:border-slate-900/60 max-w-md mx-auto text-left space-y-4">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-850 dark:text-slate-200">Rules &amp; Guidelines:</h3>
          <ul className="text-xs font-semibold text-muted-foreground space-y-2 list-disc list-inside">
            <li>Fullscreen mode must remain active.</li>
            <li>Browser tab switching or minimizing is blocked.</li>
            <li>Face must be visible in the camera feed at all times.</li>
            <li>Your session will be video-recorded for proctoring review.</li>
            <li>Time limit: 30 minutes for 25 questions.</li>
            <li>3 security warnings will result in auto-submission.</li>
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
    <div className={`max-w-3xl mx-auto px-4 py-6 space-y-6 ${phase === "running" ? "select-none" : ""}`}>

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

      {/* Security Warning Modal Overlay */}
      {showProctorWarning && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
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
              Note: Reaching 3 strikes will automatically submit your assessment.
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
                onClick={async () => {
                  setShowProctorWarning(null);
                  await requestFullscreen();
                }}
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
