export const GOVERNMENT_ID_TYPES = [
  { value: "aadhaar", label: "Aadhar Card" },
  { value: "driving_license", label: "Driving License" },
  { value: "pan", label: "PAN Card" },
  { value: "voter_id", label: "Voter ID" },
] as const;

export type GovernmentIdType = (typeof GOVERNMENT_ID_TYPES)[number]["value"];

export type VerificationFailureCode =
  | "missing_id_type"
  | "invalid_id_type"
  | "id_type_mismatch"
  | "no_face_on_id"
  | "no_face_on_selfie"
  | "face_mismatch"
  | "low_quality"
  | "spoof_suspected"
  | "engine_error";

export function isGovernmentIdType(value: unknown): value is GovernmentIdType {
  return (
    typeof value === "string" &&
    GOVERNMENT_ID_TYPES.some((t) => t.value === value)
  );
}

export function getIdTypeLabel(value: string | null | undefined): string {
  const found = GOVERNMENT_ID_TYPES.find((t) => t.value === value);
  return found?.label || value || "Unknown";
}

const ID_TYPE_ALIASES: Record<GovernmentIdType, string[]> = {
  aadhaar: ["aadhaar", "aadhar", "uidai", "unique identification"],
  driving_license: [
    "driving_license",
    "driving licence",
    "driver's license",
    "drivers license",
    "driving license",
    "dl card",
    "rto",
  ],
  pan: ["pan", "pan card", "permanent account number", "income tax"],
  voter_id: ["voter_id", "voter id", "voter card", "epic", "election commission", "elector's photo"],
};

export function normalizeDetectedIdType(raw: string | null | undefined): GovernmentIdType | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().trim().replace(/[^a-z0-9\s_]/g, " ");
  for (const [canonical, aliases] of Object.entries(ID_TYPE_ALIASES) as [
    GovernmentIdType,
    string[],
  ][]) {
    if (aliases.some((a) => cleaned.includes(a) || a.includes(cleaned))) {
      return canonical;
    }
  }
  return null;
}
