"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Loader2, Video } from "lucide-react";
import { flushRecorderAndStop, createMediaRecorder, uploadProctoringBlob } from "@/lib/proctoring-recorder-client";

type VideoCatchupClientProps = {
  testId: string;
};

export default function VideoCatchupClient({ testId }: VideoCatchupClientProps) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "recording" | "uploading" | "done" | "error">("loading");
  const [err, setErr] = useState<string | null>(null);
  const [topicTitle, setTopicTitle] = useState("Product Assessment");
  const [elapsed, setElapsed] = useState(0);

  const camStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const intentionalStopRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressUploadRef = useRef(0);

  useEffect(() => {
    const t = window.localStorage.getItem("employee_token") ?? "";
    if (!t) {
      setErr("Please sign in again.");
      setPhase("error");
      return;
    }
    setToken(t);

    fetch(`/api/employee/tests/${testId}`, {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Test not found");
        const payload = await res.json();
        const test = payload.test ?? payload;
        if (test.status !== "completed") {
          throw new Error("This upload is only for completed assessments.");
        }
        if (payload.has_recording ?? test.has_recording) {
          throw new Error("A proctoring video is already on file for this test.");
        }
        setTopicTitle(test.topic_title ?? "Product Assessment");
        setPhase("ready");
      })
      .catch((e: Error) => {
        setErr(e.message || "Failed to load test");
        setPhase("error");
      });
  }, [testId]);

  const uploadProgress = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!token || !recorder || recordingChunksRef.current.length === 0) return;
    const now = Date.now();
    if (now - progressUploadRef.current < 30000) return;
    progressUploadRef.current = now;

    const blob = new Blob(recordingChunksRef.current, {
      type: recorder.mimeType || "video/webm",
    });
    if (blob.size < 4096) return;

    const formData = new FormData();
    formData.append("video", new File([blob], `${testId}-progress.webm`, { type: "video/webm" }));
    await fetch(`/api/employee/tests/${testId}/upload_video/progress`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }).catch(() => {});
  }, [testId, token]);

  const stopAll = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    camStreamRef.current?.getTracks().forEach((track) => track.stop());
    camStreamRef.current = null;
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);

  async function startRecording() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      camStreamRef.current = stream;
      const recorder = createMediaRecorder(stream);
      if (!recorder) throw new Error("Video recording is not supported in this browser.");

      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      progressUploadRef.current = 0;
      intentionalStopRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) recordingChunksRef.current.push(event.data);
        void uploadProgress();
      };
      recorder.start(2000);
      setPhase("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e: any) {
      setErr(e.message || "Could not access camera");
      setPhase("error");
    }
  }

  async function finishAndUpload() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setErr("Recording was not active.");
      setPhase("error");
      return;
    }

    setPhase("uploading");
    if (timerRef.current) clearInterval(timerRef.current);

    intentionalStopRef.current = true;
    await flushRecorderAndStop(recorder);

    const blob = new Blob(recordingChunksRef.current, {
      type: recorder.mimeType || "video/webm",
    });

    const ok = await uploadProctoringBlob(testId, token, blob);
    stopAll();

    if (!ok) {
      setErr("Upload failed. Keep this page open and try again.");
      setPhase("error");
      return;
    }
    setPhase("done");
  }

  if (phase === "loading") {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
        Loading…
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="max-w-lg mx-auto py-16 px-4 text-center space-y-4">
        <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
        <h1 className="text-xl font-bold">Proctoring video saved</h1>
        <p className="text-sm text-muted-foreground">
          Your test score is unchanged. The recording has been linked to your completed assessment.
        </p>
        <Button className="rounded-xl" onClick={() => router.push("/employee/dashboard")}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="max-w-lg mx-auto py-16 px-4 text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
        <p className="text-sm text-red-500">{err ?? "Something went wrong"}</p>
        <Button variant="outline" className="rounded-xl" onClick={() => router.push("/employee/dashboard")}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-10 px-4 space-y-6">
      <div className="text-center space-y-2">
        <Video className="w-10 h-10 text-primary mx-auto" />
        <h1 className="text-xl font-bold">Upload Proctoring Video</h1>
        <p className="text-sm text-muted-foreground">{topicTitle}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 space-y-3 text-sm text-muted-foreground">
        <p>
          Your assessment score is already saved. We still need the proctoring recording for admin review.
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>Use Chrome or Edge with your webcam enabled</li>
          <li>Record yourself in a quiet, well-lit space for at least 2 minutes</li>
          <li>Your score will not change</li>
        </ul>
      </div>

      {phase === "recording" && (
        <p className="text-center text-sm font-semibold text-primary">
          Recording… {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
          {elapsed < 120 ? " (minimum 2 minutes recommended)" : ""}
        </p>
      )}

      {phase === "uploading" && (
        <p className="text-center text-sm font-semibold text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Uploading video…
        </p>
      )}

      <div className="flex gap-3">
        {phase === "ready" && (
          <Button className="flex-1 rounded-xl" onClick={() => void startRecording()}>
            Start Recording
          </Button>
        )}
        {phase === "recording" && (
          <Button
            className="flex-1 rounded-xl"
            disabled={elapsed < 60}
            onClick={() => void finishAndUpload()}
          >
            Finish & Upload
          </Button>
        )}
      </div>

      {phase === "recording" && elapsed < 60 && (
        <p className="text-xs text-center text-muted-foreground">Wait at least 1 minute before uploading.</p>
      )}
    </div>
  );
}
