/**
 * Pure math for face-api / FaceNet-style embedding comparison.
 * Safe for client and server (no TensorFlow / Gemini).
 */

export const FACE_DESCRIPTOR_LENGTH = 128;

/** Typical face-api threshold: distance < 0.6 ≈ same person. */
export const DEFAULT_MAX_FACE_DISTANCE = Number(
  process.env.IDENTITY_MAX_FACE_DISTANCE || 0.55
);

export function isFaceDescriptor(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === FACE_DESCRIPTOR_LENGTH &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Map distance → 0–100 confidence (distance 0 → 100, at threshold → ~70). */
export function distanceToConfidence(
  distance: number,
  maxDistance = DEFAULT_MAX_FACE_DISTANCE
): number {
  if (distance <= 0) return 100;
  // Linear map: 0 → 100, maxDistance → 70, 1.0 → ~0
  if (distance <= maxDistance) {
    return Math.round(100 - (distance / maxDistance) * 30);
  }
  const over = Math.min(1, (distance - maxDistance) / Math.max(0.01, 1 - maxDistance));
  return Math.max(0, Math.round(70 - over * 70));
}

export function matchFaceDescriptors(
  idDescriptor: number[],
  selfieDescriptor: number[],
  maxDistance = DEFAULT_MAX_FACE_DISTANCE
): { matched: boolean; confidence: number; distance: number; reason: string } {
  const distance = euclideanDistance(idDescriptor, selfieDescriptor);
  const confidence = distanceToConfidence(distance, maxDistance);
  const matched = distance <= maxDistance;
  return {
    matched,
    confidence,
    distance,
    reason: matched
      ? `Face embeddings match (distance ${distance.toFixed(3)}, confidence ${confidence}%).`
      : `Face embeddings do not match closely enough (distance ${distance.toFixed(3)}, need ≤ ${maxDistance}).`,
  };
}
