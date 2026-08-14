import { dirname, join } from "path";
import fs from "fs";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { supabaseServer } from "@/lib/db";
import { getRuntimeUploadsRoot } from "@/lib/runtime-data";
import { isCloudDeployment } from "@/lib/container-runtime";

export type DocCategory = "BR" | "JD" | "Resumes" | "Corp Pool";

const DOCS_BUCKET = "docs-ingest";

const LOCAL_DIRS: Record<DocCategory, string> = {
  BR: "BR",
  JD: "JD",
  Resumes: "Resumes",
  "Corp Pool": "Corp Pool",
};

export function useCloudDocsStorage(): boolean {
  return isCloudDeployment();
}

export function getDocsIngestMode(): "cloud" | "local" {
  return useCloudDocsStorage() ? "cloud" : "local";
}

function localDir(category: DocCategory): string {
  return join(process.cwd(), "docs", LOCAL_DIRS[category]);
}

function cloudObjectPath(category: DocCategory, filename: string): string {
  return `${LOCAL_DIRS[category]}/${filename}`;
}

function cachePath(category: DocCategory, filename: string): string {
  return join(getRuntimeUploadsRoot(), "docs-cache", LOCAL_DIRS[category], filename);
}

async function ensureLocalDir(category: DocCategory): Promise<void> {
  await mkdir(localDir(category), { recursive: true });
}

async function ensureDocsBucket(): Promise<void> {
  try {
    const { data: buckets, error } = await supabaseServer.storage.listBuckets();
    if (error) throw error;
    if (!buckets?.some((b) => b.id === DOCS_BUCKET)) {
      await supabaseServer.storage.createBucket(DOCS_BUCKET, { public: false });
    }
  } catch (e) {
    console.warn("Could not ensure docs-ingest bucket:", e);
  }
}

/** Ensures local folders (dev) or Supabase docs bucket (Vercel). */
export async function ensureDocsStorage(): Promise<void> {
  if (useCloudDocsStorage()) {
    await ensureDocsBucket();
    return;
  }
  for (const category of Object.keys(LOCAL_DIRS) as DocCategory[]) {
    await ensureLocalDir(category);
  }
  await mkdir(getRuntimeUploadsRoot(), { recursive: true });
}

export async function listDocFiles(category: DocCategory): Promise<string[]> {
  if (useCloudDocsStorage()) {
    await ensureDocsBucket();
    const prefix = LOCAL_DIRS[category];
    const { data, error } = await supabaseServer.storage
      .from(DOCS_BUCKET)
      .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (error) {
      console.warn(`listDocFiles cloud failed for ${category}:`, error.message);
      return [];
    }
    return (data ?? [])
      .filter((entry) => entry.name && entry.id !== null)
      .map((entry) => entry.name);
  }

  await ensureLocalDir(category);
  try {
    return await readdir(localDir(category));
  } catch {
    return [];
  }
}

export async function readDocFileBuffer(
  category: DocCategory,
  filename: string
): Promise<Buffer> {
  if (useCloudDocsStorage()) {
    await ensureDocsBucket();
    const objectPath = cloudObjectPath(category, filename);
    const { data, error } = await supabaseServer.storage
      .from(DOCS_BUCKET)
      .download(objectPath);
    if (error || !data) {
      throw new Error(error?.message || `Cloud doc not found: ${objectPath}`);
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    try {
      const cached = cachePath(category, filename);
      await mkdir(dirname(cached), { recursive: true });
      await writeFile(cached, buffer);
    } catch {
      // cache optional
    }
    return buffer;
  }

  return readFile(join(localDir(category), filename));
}

export async function writeDocFile(
  category: DocCategory,
  filename: string,
  buffer: Buffer
): Promise<void> {
  if (useCloudDocsStorage()) {
    await ensureDocsBucket();
    const objectPath = cloudObjectPath(category, filename);
    const { error } = await supabaseServer.storage
      .from(DOCS_BUCKET)
      .upload(objectPath, buffer, {
        contentType: "application/octet-stream",
        upsert: true,
      });
    if (error) throw new Error(error.message);
    try {
      const cached = cachePath(category, filename);
      await mkdir(dirname(cached), { recursive: true });
      await writeFile(cached, buffer);
    } catch {
      // cache optional
    }
    return;
  }

  await ensureLocalDir(category);
  await writeFile(join(localDir(category), filename), buffer);
}

/** True when cloud bucket has at least one object (used for empty-state hints). */
export async function cloudDocsHasAnyFiles(): Promise<boolean> {
  if (!useCloudDocsStorage()) return false;
  for (const category of Object.keys(LOCAL_DIRS) as DocCategory[]) {
    const files = await listDocFiles(category);
    if (files.length > 0) return true;
  }
  return false;
}

/** Migrate local docs/ folder to Supabase (one-time dev → prod helper). */
export async function syncLocalDocsToCloud(): Promise<{ uploaded: number }> {
  if (!useCloudDocsStorage()) {
    throw new Error("Cloud docs storage is not enabled");
  }
  let uploaded = 0;
  for (const category of Object.keys(LOCAL_DIRS) as DocCategory[]) {
    const dir = localDir(category);
    if (!fs.existsSync(dir)) continue;
    const files = await readdir(dir);
    for (const file of files) {
      const full = join(dir, file);
      if (!fs.statSync(full).isFile()) continue;
      const buffer = await readFile(full);
      await writeDocFile(category, file, buffer);
      uploaded++;
    }
  }
  return { uploaded };
}
