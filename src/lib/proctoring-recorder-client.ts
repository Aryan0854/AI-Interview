/** Shared browser-side proctoring recorder helpers for employee tests. */

export async function flushRecorderAndStop(recorder: MediaRecorder): Promise<void> {
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

export function createMediaRecorder(stream: MediaStream): MediaRecorder | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;
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

const MIN_RECORDING_BYTES = 4096;
/** Vercel serverless request body limit (~4.5MB); use direct-to-Supabase above this. */
const VERCEL_BODY_SAFE_BYTES = 3.5 * 1024 * 1024;

async function postVideoForm(
  testId: string,
  token: string,
  blob: Blob,
  path: "upload_video" | "upload_video/progress"
): Promise<boolean> {
  if (blob.size < MIN_RECORDING_BYTES || !token) return false;
  const formData = new FormData();
  formData.append(
    "video",
    new File([blob], `${testId}.webm`, { type: blob.type || "video/webm" })
  );
  const res = await fetch(`/api/employee/tests/${testId}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) return false;
  const payload = await res.json().catch(() => ({}));
  return payload?.success !== false;
}

async function uploadViaSignedUrl(testId: string, token: string, blob: Blob): Promise<boolean> {
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    const urlRes = await fetch(`/api/employee/tests/${testId}/video-upload-url`, {
      method: "POST",
      headers: authHeaders,
    });
    if (!urlRes.ok) return false;

    const { signedUrl } = await urlRes.json();
    if (!signedUrl) return false;

    const putRes = await fetch(signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/webm",
        "Cache-Control": "3600",
      },
      body: blob,
    });
    if (!putRes.ok) return false;

    const completeRes = await fetch(`/api/employee/tests/${testId}/upload_video`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ complete: true }),
    });
    if (!completeRes.ok) return false;

    const payload = await completeRes.json().catch(() => ({}));
    return Boolean(payload?.success);
  } catch {
    return false;
  }
}

async function uploadViaChunks(testId: string, token: string, blob: Blob): Promise<boolean> {
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

    if (!res.ok) return false;
    const payload = await res.json().catch(() => ({}));
    if (payload?.complete && payload?.success) return true;
  }

  return false;
}

export async function uploadProctoringBlob(
  testId: string,
  token: string,
  blob: Blob
): Promise<boolean> {
  if (blob.size < MIN_RECORDING_BYTES || !token) return false;

  const strategies: Array<() => Promise<boolean>> =
    blob.size > VERCEL_BODY_SAFE_BYTES
      ? [
          // Production (Vercel): bypass 4.5MB body limit via Supabase signed URL.
          () => uploadViaSignedUrl(testId, token, blob),
          () => uploadViaChunks(testId, token, blob),
          () => postVideoForm(testId, token, blob, "upload_video/progress"),
        ]
      : [
          // Local / small recordings: direct API upload is simplest.
          () => postVideoForm(testId, token, blob, "upload_video"),
          () => uploadViaSignedUrl(testId, token, blob),
          () => uploadViaChunks(testId, token, blob),
          () => postVideoForm(testId, token, blob, "upload_video/progress"),
        ];

  for (const strategy of strategies) {
    if (await strategy()) return true;
  }

  return false;
}

export async function uploadProctoringProgress(
  testId: string,
  token: string,
  blob: Blob
): Promise<boolean> {
  return postVideoForm(testId, token, blob, "upload_video/progress");
}
