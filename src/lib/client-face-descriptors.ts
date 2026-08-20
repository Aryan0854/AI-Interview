/**
 * Browser-only face embedding extraction via @vladmandic/face-api.
 * Used so hosted verification can run without GEMINI_API_KEY.
 */

"use client";

import {
  FACE_DESCRIPTOR_LENGTH,
} from "@/lib/face-descriptor-match";

const MODEL_BASE =
  process.env.NEXT_PUBLIC_FACEAPI_MODEL_URL ||
  "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";

let modelsReady: Promise<void> | null = null;

async function ensureModels(): Promise<typeof import("@vladmandic/face-api")> {
  const faceapi = await import("@vladmandic/face-api");
  if (!modelsReady) {
    modelsReady = Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_BASE),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_BASE),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_BASE),
    ]).then(() => undefined);
  }
  await modelsReady;
  return faceapi;
}

function loadHtmlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode capture image."));
    img.src = dataUrl;
  });
}

async function descriptorFromImage(
  faceapi: typeof import("@vladmandic/face-api"),
  dataUrl: string,
  label: string
): Promise<number[]> {
  const img = await loadHtmlImage(dataUrl);
  const detection = await faceapi
    .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection?.descriptor) {
    throw new Error(
      label === "id"
        ? "No clear face found on the ID photo. Recapture the card with the portrait fully visible."
        : "No clear face found in the selfie. Face the camera with good lighting and try again."
    );
  }

  const arr = Array.from(detection.descriptor);
  if (arr.length !== FACE_DESCRIPTOR_LENGTH || !arr.every((n) => Number.isFinite(n))) {
    throw new Error("Face embedding extraction returned an invalid descriptor.");
  }
  return arr;
}

export async function extractIdAndSelfieDescriptors(
  idImageBase64: string,
  selfieImageBase64: string
): Promise<{ idDescriptor: number[]; selfieDescriptor: number[] }> {
  const faceapi = await ensureModels();
  const [idDescriptor, selfieDescriptor] = await Promise.all([
    descriptorFromImage(faceapi, idImageBase64, "id"),
    descriptorFromImage(faceapi, selfieImageBase64, "selfie"),
  ]);
  return { idDescriptor, selfieDescriptor };
}
