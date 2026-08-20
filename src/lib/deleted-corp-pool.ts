import { supabase } from "@/lib/db";

const SETTINGS_KEY = "deleted_corp_pool";

export type DeletedCorpPool = {
  ids: string[];
  files: string[];
};

let cache: { at: number; value: DeletedCorpPool } | null = null;

function cleanList(values: unknown): string[] {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function emptyDeleted(): DeletedCorpPool {
  return { ids: [], files: [] };
}

export async function loadDeletedCorpPool(): Promise<DeletedCorpPool> {
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
    const value = { ids: cleanList(raw.ids), files: cleanList(raw.files) };
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.warn("Failed to load deleted Corp Pool list:", err);
    return emptyDeleted();
  }
}

async function saveDeletedCorpPool(value: DeletedCorpPool): Promise<void> {
  cache = { at: Date.now(), value };
  const { error } = await supabase.from("portal_settings").upsert({
    key: SETTINGS_KEY,
    value,
  });
  if (error) {
    console.warn("Failed to save deleted Corp Pool list:", error.message);
  }
}

export function isCorpPoolDeleted(
  deleted: DeletedCorpPool,
  parts: { id?: string; file?: string }
): boolean {
  const id = String(parts.id || "").trim().toLowerCase();
  const file = String(parts.file || "").trim().toLowerCase();
  if (id && deleted.ids.includes(id)) return true;
  if (file && deleted.files.includes(file)) return true;
  return false;
}

export async function markCorpPoolDeleted(ids: string[], files: string[] = []): Promise<void> {
  const deleted = await loadDeletedCorpPool();
  await saveDeletedCorpPool({
    ids: cleanList([...deleted.ids, ...ids]),
    files: cleanList([...deleted.files, ...files]),
  });
}

export async function unmarkCorpPoolDeleted(ids: string[], files: string[] = []): Promise<void> {
  const deleted = await loadDeletedCorpPool();
  const dropIds = new Set(cleanList(ids));
  const dropFiles = new Set(cleanList(files));
  await saveDeletedCorpPool({
    ids: deleted.ids.filter((id) => !dropIds.has(id)),
    files: deleted.files.filter((file) => !dropFiles.has(file)),
  });
}
