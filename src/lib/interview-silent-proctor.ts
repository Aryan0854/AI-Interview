/** Behavioral proctor events logged for recruiters only — no candidate UI / no auto-submit. */
export const INTERVIEW_ADMIN_ONLY_PROCTOR_TYPES = [
  "Looking Down",
  "Looking Left",
  "Looking Right",
  "Looking Up",
  "Face Missing",
  "Multiple People Detected",
  "Multiple Voices Detected",
  "Background Conversation",
  "Excessive Noise",
] as const;

export type InterviewAdminOnlyProctorType =
  (typeof INTERVIEW_ADMIN_ONLY_PROCTOR_TYPES)[number];

export function isInterviewAdminOnlyProctorType(type: string): boolean {
  return (INTERVIEW_ADMIN_ONLY_PROCTOR_TYPES as readonly string[]).includes(type);
}

/** Continuous looking-down before an admin event is recorded. */
export const LOOKING_DOWN_SECONDS = 10;
/** Other gaze directions (left/right/up). */
export const LOOK_AWAY_SECONDS = 10;
/** No face in frame. */
export const FACE_MISSING_SECONDS = 6;

/** Cooldown between identical silent logs (ms). */
export const SILENT_PROCTOR_COOLDOWN_MS = 12_000;
