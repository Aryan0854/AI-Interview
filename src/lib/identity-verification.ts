/**
 * Production identity verification: document-type check + biometric face match.
 * Primary path: Gemini multimodal (works on Vercel/Azure).
 * Optional boost: local FaceNet when Python runtime is available.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  getIdTypeLabel,
  isGovernmentIdType,
  normalizeDetectedIdType,
  type GovernmentIdType,
  type VerificationFailureCode,
} from "@/lib/identity-verification-shared";
import {
  isFaceDescriptor,
  matchFaceDescriptors,
} from "@/lib/face-descriptor-match";

export type {
  GovernmentIdType,
  VerificationFailureCode,
} from "@/lib/identity-verification-shared";
export {
  GOVERNMENT_ID_TYPES,
  getIdTypeLabel,
  isGovernmentIdType,
  normalizeDetectedIdType,
} from "@/lib/identity-verification-shared";

export interface IdentityVerificationResult {
  matched: boolean;
  confidence: number;
  reason: string;
  selectedIdType: GovernmentIdType | null;
  detectedIdType: string | null;
  idTypeMatched: boolean;
  faceMatched: boolean;
  failureCode?: VerificationFailureCode;
  engine: "gemini" | "facenet" | "hybrid" | "faceapi" | "none";
  isSystemError?: boolean;
}

function stripDataUrl(base64OrDataUrl: string): { mimeType: string; data: string } {
  const match = base64OrDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) return { mimeType: match[1], data: match[2] };
  return { mimeType: "image/jpeg", data: base64OrDataUrl };
}

function parseJsonFromModel(text: string): any {
  let cleaned = text.trim();
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
    cleaned = cleaned.substring(objStart, objEnd + 1);
  } else {
    cleaned = cleaned.replace(/```json/gi, "").replace(/```/g, "").trim();
  }
  return JSON.parse(cleaned);
}

function canUseLocalFaceNet(): boolean {
  if (process.env.FACE_MATCH_FORCE_CLOUD === "1") return false;
  if (process.env.FACE_MATCH_FORCE_LOCAL === "1") return true;
  // Prefer remote FaceNet service on hosted (Render) over spawning Python locally.
  if (process.env.FACE_MATCH_SERVICE_URL) return false;
  // Serverless / container hosts usually have no Python+torch stack
  if (process.env.VERCEL === "1") return false;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return false;
  return true;
}

/**
 * Production FaceNet on Render (or any always-on Docker host).
 * Set FACE_MATCH_SERVICE_URL=https://your-service.onrender.com
 * Optional FACE_MATCH_API_KEY must match the service env.
 */
async function runRemoteFaceNetService(
  idImageBase64: string,
  selfieImageBase64: string
): Promise<{
  matched: boolean;
  confidence: number;
  reason: string;
  failureCode?: VerificationFailureCode;
} | null> {
  const baseUrl = (process.env.FACE_MATCH_SERVICE_URL || "").trim().replace(/\/$/, "");
  if (!baseUrl) return null;

  const apiKey = (process.env.FACE_MATCH_API_KEY || "").trim();
  const controller = new AbortController();
  const timeoutMs = Number(process.env.FACE_MATCH_TIMEOUT_MS || 90_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/compare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-Face-Match-Key": apiKey } : {}),
      },
      body: JSON.stringify({
        idImage: idImageBase64,
        selfieImage: selfieImageBase64,
        ...(apiKey ? { apiKey } : {}),
      }),
      signal: controller.signal,
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Remote FaceNet service error:", res.status, payload);
      return null;
    }

    const failureRaw = String(payload.failureCode || "");
    const failureCode: VerificationFailureCode | undefined =
      failureRaw === "no_face_on_id" || failureRaw === "no_face_on_selfie"
        ? failureRaw
        : undefined;

    return {
      matched: Boolean(payload.matched),
      confidence:
        typeof payload.confidence === "number"
          ? payload.confidence
          : parseInt(String(payload.confidence), 10) || 0,
      reason: String(payload.reason || "Remote FaceNet comparison complete."),
      failureCode,
    };
  } catch (err) {
    console.error("Remote FaceNet service call failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runLocalFaceNet(
  idImageBase64: string,
  selfieImageBase64: string
): Promise<{
  matched: boolean;
  confidence: number;
  reason: string;
  failureCode?: VerificationFailureCode;
} | null> {
  if (!canUseLocalFaceNet()) return null;

  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const { writeFile, unlink, mkdir } = await import("fs/promises");
    const { join } = await import("path");
    const fs = await import("fs");
    const execPromise = promisify(exec);

    const idData = stripDataUrl(idImageBase64);
    const selfieData = stripDataUrl(selfieImageBase64);
    const tempDir =
      process.env.VERCEL === "1"
        ? join("/tmp", "identity-temp")
        : join(process.cwd(), "uploads", "temp");
    if (!fs.existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const idTempPath = join(tempDir, `id_${stamp}.jpg`);
    const selfieTempPath = join(tempDir, `selfie_${stamp}.jpg`);

    await writeFile(idTempPath, Buffer.from(idData.data, "base64"));
    await writeFile(selfieTempPath, Buffer.from(selfieData.data, "base64"));

    const pythonScriptPath = join(process.cwd(), "faceproj", "compare_images.py");
    const cmd = `python "${pythonScriptPath}" "${idTempPath}" "${selfieTempPath}"`;
    const { stdout } = await execPromise(cmd, { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });

    try {
      await unlink(idTempPath);
      await unlink(selfieTempPath);
    } catch {
      // ignore cleanup
    }

    const parsed = parseJsonFromModel(stdout);
    return {
      matched:
        typeof parsed.matched === "boolean"
          ? parsed.matched
          : Number(parsed.confidence) >= 70,
      confidence:
        typeof parsed.confidence === "number"
          ? parsed.confidence
          : parseInt(String(parsed.confidence), 10) || 0,
      reason: parsed.reason || "Local FaceNet match complete.",
    };
  } catch (err) {
    console.warn("Local FaceNet unavailable, will use cloud vision:", err);
    return null;
  }
}

async function runGeminiIdentityCheck(input: {
  idImageBase64: string;
  selfieImageBase64: string;
  selectedIdType: GovernmentIdType;
}): Promise<{
  detectedIdTypeRaw: string;
  idTypeMatched: boolean;
  faceVisibleOnId: boolean;
  faceVisibleOnSelfie: boolean;
  faceMatched: boolean;
  confidence: number;
  qualityOk: boolean;
  spoofSuspected: boolean;
  reason: string;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured for identity verification.");
  }

  const ai = new GoogleGenerativeAI(apiKey);
  const model = ai.getGenerativeModel({
    model: process.env.GEMINI_IDENTITY_MODEL || "gemini-2.0-flash",
  });

  const idPart = stripDataUrl(input.idImageBase64);
  const selfiePart = stripDataUrl(input.selfieImageBase64);
  const selectedLabel = getIdTypeLabel(input.selectedIdType);

  const prompt = `
You are a production-grade Indian government ID verification and biometric face-matching engine.

Candidate selected ID type: "${selectedLabel}" (code: ${input.selectedIdType})

You are given TWO images:
1) IMAGE_1 = Government ID document (photo/scan)
2) IMAGE_2 = Live selfie of the candidate

Tasks (be strict and objective):
A. Document classification
   - Classify IMAGE_1 as one of: aadhaar | driving_license | pan | voter_id | other | unreadable
   - Indian Aadhaar: usually 12-digit UID cues, "Aadhaar"/UIDAI branding, bilingual text.
   - PAN: "Permanent Account Number" / Income Tax Department, 10-char PAN pattern cues.
   - Driving License: RTO / "Driving Licence" / DL number cues.
   - Voter ID: Election Commission / EPIC cues.
B. Document quality
   - qualityOk=false if blurry, truncated, too dark, glare, or text/face unreadable.
C. Spoof heuristics
   - spoofSuspected=true if IMAGE_1 or IMAGE_2 looks like a screen photo, printed paper of a face, mask, or deepfake-like artifact.
D. Face presence
   - faceVisibleOnId: is there a clear human face photo printed on the ID?
   - faceVisibleOnSelfie: is there a clear live human face in IMAGE_2?
E. Face match
   - Compare the face printed on the ID with the selfie.
   - faceMatched=true only if they are clearly the same person.
   - confidence: integer 0-100 for biometric similarity (not document classification).
F. idTypeMatched
   - true only if detected document class matches the selected type (${input.selectedIdType}).
   - Treat aadhaar/aadhar as the same.
   - If unreadable/other → false.

Return ONLY raw JSON (no markdown):
{
  "detectedIdType": "aadhaar|driving_license|pan|voter_id|other|unreadable",
  "idTypeMatched": true,
  "faceVisibleOnId": true,
  "faceVisibleOnSelfie": true,
  "faceMatched": true,
  "confidence": 85,
  "qualityOk": true,
  "spoofSuspected": false,
  "reason": "One short sentence explaining the decision"
}
`;

  const result = await model.generateContent([
    { text: prompt },
    { text: "IMAGE_1 (Government ID):" },
    { inlineData: { mimeType: idPart.mimeType, data: idPart.data } },
    { text: "IMAGE_2 (Live selfie):" },
    { inlineData: { mimeType: selfiePart.mimeType, data: selfiePart.data } },
  ]);

  const text = result.response?.text?.() ?? "";
  const parsed = parseJsonFromModel(text);

  return {
    detectedIdTypeRaw: String(parsed.detectedIdType || "unreadable"),
    idTypeMatched: Boolean(parsed.idTypeMatched),
    faceVisibleOnId: Boolean(parsed.faceVisibleOnId),
    faceVisibleOnSelfie: Boolean(parsed.faceVisibleOnSelfie),
    faceMatched: Boolean(parsed.faceMatched),
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    qualityOk: parsed.qualityOk !== false,
    spoofSuspected: Boolean(parsed.spoofSuspected),
    reason: String(parsed.reason || "Identity check complete."),
  };
}

/**
 * Face-only check (legacy helpers). Prefer verifyCandidateIdentity for production gates.
 */
export async function verifyFaceBiometricsOnly(
  idImageBase64: string,
  selfieImageBase64: string
): Promise<{ matched: boolean; confidence: number; reason: string }> {
  try {
    // Reuse Gemini with a neutral selected type but ignore type mismatch for this helper
    const apiKey = process.env.GEMINI_API_KEY;
    const localFace = await runLocalFaceNet(idImageBase64, selfieImageBase64);

    if (apiKey) {
      const gemini = await runGeminiIdentityCheck({
        idImageBase64,
        selfieImageBase64,
        selectedIdType: "aadhaar",
      });
      let faceMatched = gemini.faceMatched && gemini.faceVisibleOnId && gemini.faceVisibleOnSelfie;
      let confidence = gemini.confidence;
      if (localFace) {
        faceMatched = faceMatched && localFace.matched;
        confidence = Math.round((confidence + localFace.confidence) / 2);
      }
      const MIN_CONFIDENCE = Number(process.env.IDENTITY_MIN_CONFIDENCE || 70);
      if (faceMatched && confidence < MIN_CONFIDENCE) faceMatched = false;
      return {
        matched: faceMatched,
        confidence,
        reason: gemini.reason,
      };
    }

    if (localFace) return localFace;
    throw new Error("No biometric engine available (set GEMINI_API_KEY or install local FaceNet).");
  } catch (err: any) {
    throw new Error(err?.message || "Face biometric verification failed");
  }
}

/**
 * Full production verification: selected ID type must match the card (when Gemini available),
 * and the face on the card must match the selfie.
 *
 * Hosted path without GEMINI_API_KEY: pass browser face-api descriptors
 * (`idDescriptor` + `selfieDescriptor`) for embedding match.
 */
export async function verifyCandidateIdentity(input: {
  idImageBase64: string;
  selfieImageBase64: string;
  selectedIdType?: string | null;
  idDescriptor?: number[] | null;
  selfieDescriptor?: number[] | null;
}): Promise<IdentityVerificationResult> {
  if (!isGovernmentIdType(input.selectedIdType)) {
    return {
      matched: false,
      confidence: 0,
      reason: "Please select a government ID type before verification.",
      selectedIdType: null,
      detectedIdType: null,
      idTypeMatched: false,
      faceMatched: false,
      failureCode: "invalid_id_type",
      engine: "none",
    };
  }

  const selectedIdType = input.selectedIdType;
  const hasFaceApiDescriptors =
    isFaceDescriptor(input.idDescriptor) && isFaceDescriptor(input.selfieDescriptor);
  const faceApiMatch = hasFaceApiDescriptors
    ? matchFaceDescriptors(input.idDescriptor!, input.selfieDescriptor!)
    : null;

  // Production primary: always-on FaceNet service (Render). Runs every verification.
  const remoteFace = await runRemoteFaceNetService(
    input.idImageBase64,
    input.selfieImageBase64
  );

  let geminiResult: Awaited<ReturnType<typeof runGeminiIdentityCheck>> | null = null;
  let geminiError: string | null = null;

  // Gemini is optional — ID type / spoof assist when quota allows.
  if (process.env.GEMINI_API_KEY) {
    try {
      geminiResult = await runGeminiIdentityCheck({
        idImageBase64: input.idImageBase64,
        selfieImageBase64: input.selfieImageBase64,
        selectedIdType,
      });
    } catch (err: any) {
      geminiError = err?.message || String(err);
      console.error("Gemini identity verification failed:", geminiError);
    }
  }

  const localFace =
    remoteFace == null
      ? await runLocalFaceNet(input.idImageBase64, input.selfieImageBase64)
      : null;

  const facenetFace = remoteFace || localFace;
  const facenetEngine: IdentityVerificationResult["engine"] = remoteFace
    ? "facenet"
    : localFace
      ? "facenet"
      : "none";

  // --- Path A: FaceNet service (or local) available — production biometric gate ---
  if (facenetFace) {
    if (facenetFace.failureCode === "no_face_on_id" || facenetFace.failureCode === "no_face_on_selfie") {
      return {
        matched: false,
        confidence: facenetFace.confidence,
        reason: facenetFace.reason,
        selectedIdType,
        detectedIdType: geminiResult?.detectedIdTypeRaw || selectedIdType,
        idTypeMatched: true,
        faceMatched: false,
        failureCode: facenetFace.failureCode,
        engine: facenetEngine,
      };
    }

    // Optional Gemini document checks when available
    if (geminiResult) {
      if (!geminiResult.qualityOk) {
        return {
          matched: false,
          confidence: facenetFace.confidence,
          reason:
            geminiResult.reason ||
            "ID image quality is too low. Recapture a clearer, well-lit photo of the full card.",
          selectedIdType,
          detectedIdType: geminiResult.detectedIdTypeRaw,
          idTypeMatched: false,
          faceMatched: facenetFace.matched,
          failureCode: "low_quality",
          engine: "hybrid",
        };
      }
      if (geminiResult.spoofSuspected) {
        return {
          matched: false,
          confidence: Math.min(facenetFace.confidence, 40),
          reason:
            geminiResult.reason ||
            "Possible spoof detected (screen/print). Use the original physical ID and a live selfie.",
          selectedIdType,
          detectedIdType: geminiResult.detectedIdTypeRaw,
          idTypeMatched: false,
          faceMatched: false,
          failureCode: "spoof_suspected",
          engine: "hybrid",
        };
      }
      const detectedNormalized = normalizeDetectedIdType(geminiResult.detectedIdTypeRaw);
      const idTypeMatched =
        detectedNormalized === selectedIdType ||
        (detectedNormalized === null && Boolean(geminiResult.idTypeMatched));
      if (!idTypeMatched) {
        return {
          matched: false,
          confidence: 0,
          reason: `Selected ${getIdTypeLabel(selectedIdType)}, but the uploaded document appears to be ${getIdTypeLabel(detectedNormalized) || geminiResult.detectedIdTypeRaw}. Please select the correct type or upload the matching card.`,
          selectedIdType,
          detectedIdType: geminiResult.detectedIdTypeRaw,
          idTypeMatched: false,
          faceMatched: facenetFace.matched,
          failureCode: "id_type_mismatch",
          engine: "hybrid",
        };
      }
    }

    const MIN_CONFIDENCE = Number(process.env.IDENTITY_MIN_CONFIDENCE || 70);
    let faceMatched = facenetFace.matched;
    let confidence = facenetFace.confidence;
    // Optional soft boost/check from browser face-api (never overrides a clear FaceNet fail)
    if (faceApiMatch && faceMatched && faceApiMatch.matched) {
      confidence = Math.round(confidence * 0.85 + faceApiMatch.confidence * 0.15);
    }
    if (faceMatched && confidence < MIN_CONFIDENCE) {
      faceMatched = false;
    }

    if (!faceMatched) {
      return {
        matched: false,
        confidence,
        reason: facenetFace.reason,
        selectedIdType,
        detectedIdType: geminiResult?.detectedIdTypeRaw || selectedIdType,
        idTypeMatched: true,
        faceMatched: false,
        failureCode: "face_mismatch",
        engine: geminiResult ? "hybrid" : facenetEngine,
      };
    }

    return {
      matched: true,
      confidence,
      reason: geminiResult
        ? `Identity verified via FaceNet. ${getIdTypeLabel(selectedIdType)} confirmed. ${facenetFace.reason}`
        : `${getIdTypeLabel(selectedIdType)} accepted. ${facenetFace.reason}`,
      selectedIdType,
      detectedIdType: geminiResult?.detectedIdTypeRaw || selectedIdType,
      idTypeMatched: true,
      faceMatched: true,
      engine: geminiResult ? "hybrid" : facenetEngine,
    };
  }

  // --- Path B: No FaceNet — face-api / Gemini fallbacks ---
  if (!geminiResult) {
    if (faceApiMatch) {
      const MIN_CONFIDENCE = Number(process.env.IDENTITY_MIN_CONFIDENCE || 70);
      let faceMatched = faceApiMatch.matched;
      let confidence = faceApiMatch.confidence;
      if (faceMatched && confidence < MIN_CONFIDENCE) {
        faceMatched = false;
      }
      if (!faceMatched) {
        return {
          matched: false,
          confidence,
          reason: faceApiMatch.reason,
          selectedIdType,
          detectedIdType: selectedIdType,
          idTypeMatched: true,
          faceMatched: false,
          failureCode: "face_mismatch",
          engine: "faceapi",
        };
      }
      return {
        matched: true,
        confidence,
        reason: `${getIdTypeLabel(selectedIdType)} accepted (selected by candidate). ${faceApiMatch.reason}`,
        selectedIdType,
        detectedIdType: selectedIdType,
        idTypeMatched: true,
        faceMatched: true,
        engine: "faceapi",
      };
    }

    return {
      matched: false,
      confidence: 0,
      reason: `Identity verification engine unavailable. Configure FACE_MATCH_SERVICE_URL (Render FaceNet) for production. Images saved for manual audit. ${geminiError || ""}`.trim(),
      selectedIdType,
      detectedIdType: null,
      idTypeMatched: false,
      faceMatched: false,
      failureCode: "engine_error",
      engine: "none",
      isSystemError: true,
    };
  }

  const detectedNormalized = normalizeDetectedIdType(geminiResult.detectedIdTypeRaw);
  // Prefer normalized class equality; allow model flag only when class is ambiguous
  const idTypeMatched =
    detectedNormalized === selectedIdType ||
    (detectedNormalized === null && Boolean(geminiResult.idTypeMatched));

  if (!geminiResult.qualityOk) {
    return {
      matched: false,
      confidence: geminiResult.confidence,
      reason:
        geminiResult.reason ||
        "ID image quality is too low. Recapture a clearer, well-lit photo of the full card.",
      selectedIdType,
      detectedIdType: geminiResult.detectedIdTypeRaw,
      idTypeMatched,
      faceMatched: false,
      failureCode: "low_quality",
      engine: faceApiMatch ? "hybrid" : "gemini",
    };
  }

  if (geminiResult.spoofSuspected) {
    return {
      matched: false,
      confidence: Math.min(geminiResult.confidence, 40),
      reason:
        geminiResult.reason ||
        "Possible spoof detected (screen/print). Use the original physical ID and a live selfie.",
      selectedIdType,
      detectedIdType: geminiResult.detectedIdTypeRaw,
      idTypeMatched,
      faceMatched: false,
      failureCode: "spoof_suspected",
      engine: faceApiMatch ? "hybrid" : "gemini",
    };
  }

  if (!idTypeMatched) {
    return {
      matched: false,
      confidence: 0,
      reason: `Selected ${getIdTypeLabel(selectedIdType)}, but the uploaded document appears to be ${getIdTypeLabel(detectedNormalized) || geminiResult.detectedIdTypeRaw}. Please select the correct type or upload the matching card.`,
      selectedIdType,
      detectedIdType: geminiResult.detectedIdTypeRaw,
      idTypeMatched: false,
      faceMatched: false,
      failureCode: "id_type_mismatch",
      engine: faceApiMatch ? "hybrid" : "gemini",
    };
  }

  if (!geminiResult.faceVisibleOnId && !faceApiMatch?.matched) {
    return {
      matched: false,
      confidence: 0,
      reason: "No clear face photo found on the ID. Ensure the card portrait is fully visible and sharp.",
      selectedIdType,
      detectedIdType: geminiResult.detectedIdTypeRaw,
      idTypeMatched: true,
      faceMatched: false,
      failureCode: "no_face_on_id",
      engine: "gemini",
    };
  }

  if (!geminiResult.faceVisibleOnSelfie && !faceApiMatch?.matched) {
    return {
      matched: false,
      confidence: 0,
      reason: "No clear face found in the selfie. Face the camera with good lighting and try again.",
      selectedIdType,
      detectedIdType: geminiResult.detectedIdTypeRaw,
      idTypeMatched: true,
      faceMatched: false,
      failureCode: "no_face_on_selfie",
      engine: "gemini",
    };
  }

  // FaceNet unavailable — Gemini ± browser face-api only
  let faceMatched = geminiResult.faceMatched;
  let confidence = geminiResult.confidence;
  let engine: IdentityVerificationResult["engine"] = "gemini";
  let reason = geminiResult.reason;

  if (faceApiMatch) {
    engine = "hybrid";
    if (geminiResult.faceMatched && faceApiMatch.matched) {
      faceMatched = true;
      confidence = Math.round((geminiResult.confidence + faceApiMatch.confidence) / 2);
      reason = `ID type confirmed as ${getIdTypeLabel(selectedIdType)}. Biometric match confirmed by cloud vision and face embeddings.`;
    } else if (!geminiResult.faceMatched && faceApiMatch.matched && faceApiMatch.confidence >= 75) {
      faceMatched = true;
      confidence = faceApiMatch.confidence;
      reason = `ID type confirmed. Face match accepted via embeddings (${faceApiMatch.reason})`;
      engine = "faceapi";
    } else if (geminiResult.faceMatched && !faceApiMatch.matched) {
      faceMatched = false;
      confidence = Math.min(geminiResult.confidence, faceApiMatch.confidence);
      reason = `ID type OK, but face embeddings disagreed with cloud score. ${faceApiMatch.reason}`;
    } else {
      faceMatched = false;
      confidence = Math.max(geminiResult.confidence, faceApiMatch.confidence);
      reason = geminiResult.reason || faceApiMatch.reason;
    }
  }

  const MIN_CONFIDENCE = Number(process.env.IDENTITY_MIN_CONFIDENCE || 70);
  if (faceMatched && confidence < MIN_CONFIDENCE) {
    faceMatched = false;
    reason = `Face similarity ${confidence}% is below the required ${MIN_CONFIDENCE}% threshold. Retake a clearer selfie facing the camera.`;
  }

  if (!faceMatched) {
    return {
      matched: false,
      confidence,
      reason:
        reason ||
        "The face on the ID does not match the live selfie. Ensure the same person is photographed.",
      selectedIdType,
      detectedIdType: geminiResult.detectedIdTypeRaw,
      idTypeMatched: true,
      faceMatched: false,
      failureCode: "face_mismatch",
      engine,
    };
  }

  return {
    matched: true,
    confidence,
    reason:
      reason ||
      `Identity verified. ${getIdTypeLabel(selectedIdType)} confirmed and biometric match confidence ${confidence}%.`,
    selectedIdType,
    detectedIdType: geminiResult.detectedIdTypeRaw,
    idTypeMatched: true,
    faceMatched: true,
    engine,
  };
}
