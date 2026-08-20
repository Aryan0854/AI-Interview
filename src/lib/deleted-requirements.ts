import { supabase } from "@/lib/db";
import { parseJdRequirements } from "@/lib/skill-match";

const SETTINGS_KEY = "deleted_requirements";

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
  return prefix.trim().toLowerCase();
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
  return { ids: [], brIds: [], groupKeys: [] };
}

export async function loadDeletedRequirements(): Promise<DeletedRequirements> {
  if (cache && Date.now() - cache.at < 4000) return cache.value;
  try {
    const { data, error } = await supabase
      .from("portal_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (error || !data?.value || typeof data.value !== "object") {
      cache = { at: Date.now(), value: emptyDeleted() };
      return cache.value;
    }
    const raw = data.value as Record<string, unknown>;
    const value = {
      ids: cleanList(raw.ids),
      brIds: cleanList(raw.brIds),
      groupKeys: cleanList(raw.groupKeys),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.warn("Failed to load deleted requirements:", err);
    return emptyDeleted();
  }
}

async function saveDeletedRequirements(value: DeletedRequirements): Promise<void> {
  cache = { at: Date.now(), value };
  const { error } = await supabase.from("portal_settings").upsert({
    key: SETTINGS_KEY,
    value,
  });
  if (error) {
    console.warn("Failed to save deleted requirements:", error.message);
  }
}

export function isRequirementDeleted(
  deleted: DeletedRequirements,
  parts: { id?: string; brId?: string; groupKey?: string; fileName?: string; jdText?: string }
): boolean {
  const id = String(parts.id || "").trim().toLowerCase();
  const brId = extractBrId(parts.brId || parts.fileName);
  if (id && deleted.ids.includes(id)) return true;
  if (brId && deleted.brIds.includes(brId)) return true;
  return false;
}

export async function markRequirementsDeleted(
  rows: Array<{ id?: string; fileName?: string; jdText?: string }>
): Promise<void> {
  const deleted = await loadDeletedRequirements();
  const ids = new Set(deleted.ids);
  const brIds = new Set(deleted.brIds);
  const groupKeys = new Set(deleted.groupKeys);

  for (const row of rows) {
    const id = String(row.id || "").trim().toLowerCase();
    const brId = extractBrId(row.fileName);
    const groupKey = requirementTombstoneKey(row.jdText || "", row.id || "");
    if (id) ids.add(id);
    if (brId) brIds.add(brId);
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
  const deleted = await loadDeletedRequirements();
  const ids = new Set(deleted.ids);
  const brIds = new Set(deleted.brIds);
  const groupKeys = new Set(deleted.groupKeys);

  for (const row of rows) {
    const id = String(row.id || "").trim().toLowerCase();
    const brId = extractBrId(row.brId || row.fileName);
    const rawBrId = String(row.brId || "").trim().toLowerCase();
    const groupKey = requirementTombstoneKey(row.jdText || "", row.id || "");
    if (id) ids.delete(id);
    if (brId) brIds.delete(brId);
    if (rawBrId) brIds.delete(rawBrId);
    if (groupKey) groupKeys.delete(groupKey);
  }

  await saveDeletedRequirements({
    ids: Array.from(ids),
    brIds: Array.from(brIds),
    groupKeys: Array.from(groupKeys),
  });
}
