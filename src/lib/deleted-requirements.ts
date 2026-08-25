import { supabaseServer } from "@/lib/db";
import { parseJdRequirements } from "@/lib/skill-match";

const SETTINGS_KEY = "deleted_requirements";

/** Previously blocked BR IDs. Empty so a re-uploaded JD like 50656BR.docx can appear again. */
export const PERMANENTLY_REMOVED_BR_IDS: string[] = [];

export type DeletedRequirements = {
  ids: string[];
  brIds: string[];
  groupKeys: string[];
};

let cache: { at: number; value: DeletedRequirements } | null = null;

function cleanList(values: unknown): string[] {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function extractBrId(fileName?: string): string {
  const prefix = String(fileName || "").split("|")[0] || "";
  const match = prefix.trim().match(/(\d+)\s*BR/i);
  if (match) return `${match[1]}BR`.toLowerCase();
  if (/^\d{4,}$/.test(prefix.trim())) return `${prefix.trim()}br`;
  return prefix.trim().toLowerCase();
}

export function isPermanentlyRemovedBrId(brId?: string): boolean {
  const normalized = extractBrId(brId);
  return Boolean(normalized && PERMANENTLY_REMOVED_BR_IDS.includes(normalized));
}

export function requirementTombstoneKey(jdText: string, fallbackId = ""): string {
  const parsed = parseJdRequirements(jdText || "");
  const title = (parsed.title || "").replace(/\s+/g, " ").trim().toLowerCase();
  const skills = parsed.mandatoryRaw
    .join(",")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!title && !skills) return fallbackId ? `id:${fallbackId.toLowerCase()}` : "";
  return `${title}::${skills}`;
}

function emptyDeleted(): DeletedRequirements {
  return {
    ids: [],
    brIds: [...PERMANENTLY_REMOVED_BR_IDS],
    groupKeys: [],
  };
}

function withPermanentBrIds(value: DeletedRequirements): DeletedRequirements {
  return {
    ids: cleanList(value.ids),
    brIds: cleanList([...PERMANENTLY_REMOVED_BR_IDS, ...value.brIds]),
    groupKeys: cleanList(value.groupKeys),
  };
}

function collectedBrIds(parts: { brId?: string; fileName?: string }): string[] {
  return cleanList([extractBrId(parts.brId), extractBrId(parts.fileName)]);
}

export async function loadDeletedRequirements(opts?: { fresh?: boolean }): Promise<DeletedRequirements> {
  if (!opts?.fresh && cache && Date.now() - cache.at < 4000) return cache.value;
  try {
    const { data, error } = await supabaseServer
      .from("portal_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (error || !data?.value || typeof data.value !== "object") {
      console.warn("Failed to load deleted requirements:", error?.message || "empty settings");
      return emptyDeleted();
    }
    const raw = data.value as Record<string, unknown>;
    const value = withPermanentBrIds({
      ids: cleanList(raw.ids),
      brIds: cleanList(raw.brIds),
      groupKeys: cleanList(raw.groupKeys),
    });
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.warn("Failed to load deleted requirements:", err);
    return emptyDeleted();
  }
}

async function saveDeletedRequirements(value: DeletedRequirements): Promise<void> {
  const next = withPermanentBrIds(value);
  cache = { at: Date.now(), value: next };
  const { error } = await supabaseServer.from("portal_settings").upsert(
    {
      key: SETTINGS_KEY,
      value: next,
    },
    { onConflict: "key" }
  );
  if (error) {
    console.warn("Failed to save deleted requirements:", error.message);
  }
}

export function isRequirementDeleted(
  deleted: DeletedRequirements,
  parts: { id?: string; brId?: string; groupKey?: string; fileName?: string; jdText?: string }
): boolean {
  const id = String(parts.id || "").trim().toLowerCase();
  if (id && deleted.ids.includes(id)) return true;
  const brIds = collectedBrIds(parts);
  return brIds.some((brId) => deleted.brIds.includes(brId) || isPermanentlyRemovedBrId(brId));
}

export async function markRequirementsDeleted(
  rows: Array<{ id?: string; fileName?: string; jdText?: string; brId?: string }>
): Promise<void> {
  const deleted = await loadDeletedRequirements({ fresh: true });
  const ids = new Set(deleted.ids);
  const brIds = new Set(deleted.brIds);
  const groupKeys = new Set(deleted.groupKeys);

  for (const row of rows) {
    const id = String(row.id || "").trim().toLowerCase();
    const groupKey = requirementTombstoneKey(row.jdText || "", row.id || "");
    if (id) ids.add(id);
    for (const brId of collectedBrIds(row)) brIds.add(brId);
    if (groupKey) groupKeys.add(groupKey);
  }

  await saveDeletedRequirements({
    ids: Array.from(ids),
    brIds: Array.from(brIds),
    groupKeys: Array.from(groupKeys),
  });
}

export async function unmarkRequirementsDeleted(
  rows: Array<{ id?: string; fileName?: string; jdText?: string; brId?: string }>
): Promise<void> {
  const deleted = await loadDeletedRequirements({ fresh: true });
  const ids = new Set(deleted.ids);
  const brIds = new Set(deleted.brIds);
  const groupKeys = new Set(deleted.groupKeys);

  for (const row of rows) {
    if (collectedBrIds(row).some(isPermanentlyRemovedBrId)) continue;
    const id = String(row.id || "").trim().toLowerCase();
    const groupKey = requirementTombstoneKey(row.jdText || "", row.id || "");
    if (id) ids.delete(id);
    for (const brId of collectedBrIds(row)) brIds.delete(brId);
    if (groupKey) groupKeys.delete(groupKey);
  }

  await saveDeletedRequirements({
    ids: Array.from(ids),
    brIds: Array.from(brIds),
    groupKeys: Array.from(groupKeys),
  });
}
