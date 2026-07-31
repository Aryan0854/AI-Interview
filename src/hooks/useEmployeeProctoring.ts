"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPLOYEE_PROCTOR_MAX_VIOLATIONS,
  EMPLOYEE_PROCTOR_VIOLATION_COOLDOWN_MS,
  type EmployeeProctoringState,
} from "@/lib/employee-proctoring";

export function isFullscreenActive(): boolean {
  if (typeof document === "undefined") return false;
  return !!(
    document.fullscreenElement ||
    (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ||
    (document as Document & { mozFullScreenElement?: Element }).mozFullScreenElement
  );
}

const BLOCKED_DEVTOOLS =
  /^(F12|F5|F11)$/i;

type ProctorPhase = "loading" | "ready" | "running" | "retake-confirm" | "submitted" | "error";

export function useEmployeeProctoring(options: {
  testId: string;
  token: string;
  phase: ProctorPhase;
  answersRef: React.MutableRefObject<Record<number, number>>;
  onAutoSubmit: (answers: Record<number, number>) => void;
  requestFullscreen: () => Promise<void>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  camStream: MediaStream | null;
  mediaRecorderRef: React.MutableRefObject<MediaRecorder | null>;
  clmReady: boolean;
  initialProctoring?: EmployeeProctoringState | null;
  intentionalRecorderStopRef: React.MutableRefObject<boolean>;
}) {
  const {
    testId,
    token,
    phase,
    answersRef,
    onAutoSubmit,
    requestFullscreen,
    videoRef,
    camStream,
    mediaRecorderRef,
    clmReady,
    initialProctoring,
    intentionalRecorderStopRef,
  } = options;

  const [warningCount, setWarningCount] = useState(initialProctoring?.warningCount ?? 0);
  const [showProctorWarning, setShowProctorWarning] = useState<string | null>(null);
  const lastTriggerRef = useRef<Record<string, number>>({});
  const autoSubmitTriggeredRef = useRef(false);
  const everHadFullscreenRef = useRef(false);
  const onAutoSubmitRef = useRef(onAutoSubmit);
  onAutoSubmitRef.current = onAutoSubmit;

  useEffect(() => {
    if (initialProctoring?.warningCount != null) {
      setWarningCount(initialProctoring.warningCount);
    }
  }, [initialProctoring?.warningCount]);

  const persistProctorViolation = useCallback(
    async (violationType: string, detail?: string) => {
      if (!token) return null;
      try {
        const res = await fetch(`/api/employee/tests/${testId}/proctor_violation`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ violationType, detail }),
        });
        if (!res.ok) return null;
        const payload = await res.json();
        return payload.proctoring as EmployeeProctoringState;
      } catch (err) {
        console.warn("Failed to persist proctor violation:", err);
        return null;
      }
    },
    [testId, token]
  );

  const violationMessage = useCallback((violationType: string, count: number) => {
    if (count >= EMPLOYEE_PROCTOR_MAX_VIOLATIONS) {
      return `You have exceeded the maximum of ${EMPLOYEE_PROCTOR_MAX_VIOLATIONS} security violations. Your assessment is being automatically submitted.`;
    }
    const messages: Record<string, string> = {
      "Tab Switch Detected": "You switched browser tabs or minimized the window. This is prohibited during the test.",
      "Window Lost Focus": "You left the test window or opened another application.",
      "Page Navigation Attempt": "Leaving this page during the test is not allowed.",
      "Right Click Attempted": "Right-clicking and context menus are disabled during the test.",
      "DevTools Shortcut Blocked": "Developer tools and view-source shortcuts are blocked.",
      "Copy/Paste Attempted": "Copying, cutting, or pasting text is disabled during the test.",
      "Fullscreen Mode Exited": "You exited fullscreen mode. You must remain in fullscreen for the entire test.",
      "Camera Disabled": "Your camera was turned off or disconnected. Camera must remain active.",
      "Camera Track Lost": "Camera feed lost. Please keep your camera enabled and visible.",
      "Recording Interrupted": "Session recording stopped unexpectedly. Do not disable camera or close the browser.",
      "Face Missing": "Face not detected in camera feed. Please face your screen clearly.",
      "Looking Away": "Please look directly at your screen.",
      "Looking Down (possible phone usage)": "Please look at your screen — looking down is flagged as a violation.",
      "Looking Left": "Please face the camera — looking left is flagged as distraction.",
      "Looking Right": "Please face the camera — looking right is flagged as distraction.",
      "Looking Up": "Please face the camera — looking up is flagged as distraction.",
      "Multiple Faces Detected": "Multiple faces detected. Only the test taker may be visible.",
      "Print Attempt Blocked": "Printing the test page is not allowed.",
      "Refresh Attempt Blocked": "Refreshing the page during the test is not allowed.",
    };
    return messages[violationType] ?? `Security violation flagged: ${violationType}.`;
  }, []);

  const triggerProctorWarning = useCallback(
    (violationType: string, detail?: string) => {
      if (phase !== "running") return;
      if (autoSubmitTriggeredRef.current) return;

      const nowMs = Date.now();
      const lastForType = lastTriggerRef.current[violationType] ?? 0;
      // Face anomalies use a slightly longer per-type cooldown to reduce noise.
      const cooldown =
        /face|looking|multiple/i.test(violationType)
          ? Math.max(EMPLOYEE_PROCTOR_VIOLATION_COOLDOWN_MS, 5000)
          : EMPLOYEE_PROCTOR_VIOLATION_COOLDOWN_MS;
      if (nowMs - lastForType < cooldown) return;
      lastTriggerRef.current[violationType] = nowMs;

      void (async () => {
        const serverState = await persistProctorViolation(violationType, detail);
        const nextCount = serverState?.warningCount ?? Math.min(warningCount + 1, EMPLOYEE_PROCTOR_MAX_VIOLATIONS);
        setWarningCount(nextCount);

        const msgText = violationMessage(violationType, nextCount);
        setShowProctorWarning(msgText);

        if (nextCount >= EMPLOYEE_PROCTOR_MAX_VIOLATIONS && !autoSubmitTriggeredRef.current) {
          autoSubmitTriggeredRef.current = true;
          setTimeout(() => {
            setShowProctorWarning(null);
            onAutoSubmitRef.current(answersRef.current);
          }, 1800);
        }
      })();
    },
    [phase, persistProctorViolation, violationMessage, warningCount, answersRef]
  );

  const dismissWarning = useCallback(async () => {
    setShowProctorWarning(null);
    await requestFullscreen();
    if (!isFullscreenActive()) {
      triggerProctorWarning("Fullscreen Mode Exited");
    }
  }, [requestFullscreen, triggerProctorWarning]);

  // ── Browser integrity listeners ───────────────────────────────
  useEffect(() => {
    if (phase !== "running") return;

    let blurVisibilityTimer: ReturnType<typeof setTimeout> | null = null;
    let focusViolationPending = false;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        focusViolationPending = true;
        if (blurVisibilityTimer) clearTimeout(blurVisibilityTimer);
        blurVisibilityTimer = setTimeout(() => {
          if (document.visibilityState === "hidden") {
            triggerProctorWarning("Tab Switch Detected");
          }
          focusViolationPending = false;
        }, 400);
      } else if (focusViolationPending) {
        focusViolationPending = false;
        if (blurVisibilityTimer) clearTimeout(blurVisibilityTimer);
      }
    };

    const handleWindowBlur = () => {
      if (document.visibilityState === "visible") {
        if (blurVisibilityTimer) clearTimeout(blurVisibilityTimer);
        blurVisibilityTimer = setTimeout(() => {
          if (!document.hasFocus()) {
            triggerProctorWarning("Window Lost Focus");
          }
        }, 400);
      }
    };

    const handlePageHide = () => {
      triggerProctorWarning("Page Navigation Attempt");
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Your test is in progress. Leaving will record a proctoring violation.";
      triggerProctorWarning("Page Navigation Attempt");
      return e.returnValue;
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      triggerProctorWarning("Right Click Attempted");
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      if (BLOCKED_DEVTOOLS.test(key)) {
        e.preventDefault();
        e.stopPropagation();
        triggerProctorWarning(key.toUpperCase() === "F5" ? "Refresh Attempt Blocked" : "DevTools Shortcut Blocked");
        return;
      }

      const isDevToolsShortcut =
        (isCmdOrCtrl && isShift && /[ijcJIC]/.test(key)) ||
        (isCmdOrCtrl && /[uswtpUSWTP]/.test(key)) ||
        key === "PrintScreen";

      if (isDevToolsShortcut) {
        e.preventDefault();
        e.stopPropagation();
        triggerProctorWarning(
          key === "PrintScreen" || (isCmdOrCtrl && /[pP]/.test(key))
            ? "Print Attempt Blocked"
            : "DevTools Shortcut Blocked"
        );
      }
    };

    const handleCopyCutPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      triggerProctorWarning("Copy/Paste Attempted");
    };

    const handleSelectStart = (e: Event) => {
      e.preventDefault();
    };

    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleFullscreenChange = () => {
      if (isFullscreenActive()) {
        everHadFullscreenRef.current = true;
        return;
      }
      if (everHadFullscreenRef.current) {
        triggerProctorWarning("Fullscreen Mode Exited");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("copy", handleCopyCutPaste);
    document.addEventListener("cut", handleCopyCutPaste);
    document.addEventListener("paste", handleCopyCutPaste);
    document.addEventListener("selectstart", handleSelectStart);
    document.addEventListener("dragstart", handleDragStart);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);

    return () => {
      if (blurVisibilityTimer) clearTimeout(blurVisibilityTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("copy", handleCopyCutPaste);
      document.removeEventListener("cut", handleCopyCutPaste);
      document.removeEventListener("paste", handleCopyCutPaste);
      document.removeEventListener("selectstart", handleSelectStart);
      document.removeEventListener("dragstart", handleDragStart);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
    };
  }, [phase, triggerProctorWarning]);

  // ── Fullscreen watchdog ─────────────────────────────────────────
  useEffect(() => {
    if (phase !== "running") return;
    if (isFullscreenActive()) {
      everHadFullscreenRef.current = true;
    }
    const id = setInterval(() => {
      const active = isFullscreenActive();
      if (active) {
        everHadFullscreenRef.current = true;
        return;
      }
      if (everHadFullscreenRef.current) {
        triggerProctorWarning("Fullscreen Mode Exited");
        void requestFullscreen();
      }
      if (!document.hasFocus() && document.visibilityState === "visible") {
        triggerProctorWarning("Window Lost Focus");
      }
    }, 3000);
    return () => clearInterval(id);
  }, [phase, triggerProctorWarning, requestFullscreen]);

  // ── Camera + recorder integrity ───────────────────────────────
  useEffect(() => {
    if (phase !== "running" || !camStream) return;

    const onTrackEnded = () => {
      triggerProctorWarning("Camera Track Lost");
    };

    for (const track of camStream.getVideoTracks()) {
      track.addEventListener("ended", onTrackEnded);
      track.addEventListener("mute", onTrackEnded);
      if (!track.enabled || track.readyState === "ended") {
        triggerProctorWarning("Camera Disabled");
      }
    }

    const recorder = mediaRecorderRef.current;
    const onRecorderStop = () => {
      if (intentionalRecorderStopRef.current) return;
      if (phase === "running" && !autoSubmitTriggeredRef.current) {
        triggerProctorWarning("Recording Interrupted");
      }
    };
    if (recorder) {
      recorder.addEventListener("stop", onRecorderStop);
    }

    const monitorId = setInterval(() => {
      const videoTrack = camStream.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState === "ended" || !videoTrack.enabled) {
        triggerProctorWarning("Camera Disabled");
      }
      if (
        !intentionalRecorderStopRef.current &&
        recorder &&
        recorder.state === "inactive" &&
        phase === "running"
      ) {
        triggerProctorWarning("Recording Interrupted");
      }
    }, 5000);

    return () => {
      for (const track of camStream.getVideoTracks()) {
        track.removeEventListener("ended", onTrackEnded);
        track.removeEventListener("mute", onTrackEnded);
      }
      if (recorder) recorder.removeEventListener("stop", onRecorderStop);
      clearInterval(monitorId);
    };
  }, [phase, camStream, mediaRecorderRef, triggerProctorWarning, intentionalRecorderStopRef]);

  // ── Face + gaze tracking (clmtrackr) + multi-face (FaceDetector) ─
  useEffect(() => {
    if (phase !== "running" || !camStream) return;

    type ClmTracker = {
      init: (m: unknown) => void;
      start: (v: HTMLVideoElement) => void;
      stop: () => void;
      getCurrentPosition: () => number[][] | false;
      getScore: () => number;
    };

    let trackerInstance: ClmTracker | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let multiFaceIntervalId: ReturnType<typeof setInterval> | null = null;
    let lastState: "one" | "none" | "left" | "right" | "up" | "down" = "one";
    let stateStartTime = Date.now();
    let isTracking = false;
    const stateHistory: string[] = [];
    let cancelled = false;

    const startTracking = () => {
      if (!clmReady) return;
      const w = window as Window & { clm?: { tracker: new () => ClmTracker }; pModel?: unknown };
      if (!w.clm || !w.pModel || !videoRef.current || videoRef.current.readyState < 2) return;
      try {
        const instance = new w.clm.tracker();
        instance.init(w.pModel);
        instance.start(videoRef.current);
        trackerInstance = instance;
        isTracking = true;
      } catch (err) {
        console.debug("Failed to start clmtrackr:", err);
      }
    };

    const timer = setTimeout(startTracking, 1000);

    // Gaze / face-present monitoring via clmtrackr landmarks.
    intervalId = setInterval(() => {
      if (!clmReady) return;
      if (!isTracking || !trackerInstance) {
        if (videoRef.current && videoRef.current.readyState >= 2 && !isTracking) startTracking();
        return;
      }

      const positions = trackerInstance.getCurrentPosition();
      const score = trackerInstance.getScore();
      let detectedState: typeof lastState = "one";

      if (!positions || positions.length < 70 || score < 0.35) {
        detectedState = "none";
      } else {
        const noseX = positions[62][0];
        const noseY = positions[62][1];
        const leftFaceX = positions[1][0];
        const rightFaceX = positions[13][0];
        const noseBridgeY = positions[33][1];
        const chinY = positions[7][1];
        const horizontalRatio = (noseX - leftFaceX) / (rightFaceX - noseX || 1);
        const verticalRatio = (noseY - noseBridgeY) / (chinY - noseY || 1);

        if (horizontalRatio < 0.72) detectedState = "right";
        else if (horizontalRatio > 1.32) detectedState = "left";
        else if (verticalRatio < 0.42) detectedState = "up";
        else if (verticalRatio > 0.88) detectedState = "down";
        else detectedState = "one";
      }

      stateHistory.push(detectedState);
      if (stateHistory.length > 5) stateHistory.shift();

      const counts: Record<string, number> = {};
      let smoothedState = detectedState;
      let maxCount = 0;
      for (const s of stateHistory) {
        counts[s] = (counts[s] || 0) + 1;
        if (counts[s] > maxCount) {
          maxCount = counts[s];
          smoothedState = s as typeof lastState;
        }
      }

      const now = Date.now();
      if (smoothedState !== lastState) {
        lastState = smoothedState;
        stateStartTime = now;
      } else {
        const duration = (now - stateStartTime) / 1000;
        if (lastState === "none" && duration >= 3.0) {
          triggerProctorWarning(
            "Face Missing",
            `No face detected for ${duration.toFixed(1)}s`
          );
          stateStartTime = now;
        } else if (lastState === "down" && duration >= 2.8) {
          triggerProctorWarning(
            "Looking Down (possible phone usage)",
            `Looking down for ${duration.toFixed(1)}s`
          );
          stateStartTime = now;
        } else if (lastState === "left" && duration >= 3.0) {
          triggerProctorWarning("Looking Left", `Gaze left for ${duration.toFixed(1)}s`);
          stateStartTime = now;
        } else if (lastState === "right" && duration >= 3.0) {
          triggerProctorWarning("Looking Right", `Gaze right for ${duration.toFixed(1)}s`);
          stateStartTime = now;
        } else if (lastState === "up" && duration >= 3.0) {
          triggerProctorWarning("Looking Up", `Gaze up for ${duration.toFixed(1)}s`);
          stateStartTime = now;
        }
      }
    }, 1000);

    // Multi-person detection via Chromium FaceDetector API (Chrome/Edge).
    const FaceDetectorCtor = (window as any).FaceDetector as
      | (new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
          detect: (image: CanvasImageSource) => Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
        })
      | undefined;

    if (typeof FaceDetectorCtor === "function") {
      let detector: InstanceType<typeof FaceDetectorCtor> | null = null;
      try {
        detector = new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 5 });
      } catch {
        detector = null;
      }

      if (detector) {
        multiFaceIntervalId = setInterval(async () => {
          if (cancelled || !videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const faces = await detector!.detect(videoRef.current);
            if (faces.length >= 2) {
              triggerProctorWarning(
                "Multiple Faces Detected",
                `${faces.length} faces visible in camera frame`
              );
            }
          } catch {
            // FaceDetector may fail on some frames; ignore transient errors.
          }
        }, 2000);
      }
    }

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (intervalId) clearInterval(intervalId);
      if (multiFaceIntervalId) clearInterval(multiFaceIntervalId);
      try {
        trackerInstance?.stop();
      } catch {
        // ignore
      }
    };
  }, [phase, clmReady, camStream, triggerProctorWarning, videoRef]);

  return {
    warningCount,
    showProctorWarning,
    dismissWarning,
    triggerProctorWarning,
  };
}
