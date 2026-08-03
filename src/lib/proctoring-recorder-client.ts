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

export async function uploadProctoringBlob(
  testId: string,
  token: string,
  blob: Blob
): Promise<boolean> {
  if (blob.size <= 0 || !token) return false;
  if (!(await validateRecordingBlob(blob))) return false;

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

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
  } catch {
    // fall through
  }

  if (blob.size <= 4 * 1024 * 1024) {
    try {
      const formData = new FormData();
      formData.append("video", new File([blob], `${testId}.webm`, { type: "video/webm" }));
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
      // fall through
    }
  }

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

export async function uploadProctoringProgress(
  testId: string,
  token: string,
  blob: Blob
): Promise<boolean> {
  if (blob.size < 4096 || !token) return false;
  const formData = new FormData();
  formData.append("video", new File([blob], `${testId}-progress.webm`, { type: "video/webm" }));
  const res = await fetch(`/api/employee/tests/${testId}/upload_video/progress`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  return res.ok;
}
