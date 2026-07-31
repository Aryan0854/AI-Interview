/** Shared portal timestamps — always IST for admin exports and UI. */
export const PORTAL_TIMEZONE = "Asia/Kolkata";

export function formatPortalTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", {
    timeZone: PORTAL_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function formatAttemptResult(isCorrect: boolean | null): string {
  if (isCorrect === true) return "Correct";
  if (isCorrect === false) return "Incorrect";
  return "";
}
