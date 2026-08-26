import { dirname, join } from "path";
import fs from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { supabaseServer } from "@/lib/db";
import { getRuntimeUploadsRoot, isCloudDeployment } from "@/lib/container-runtime";

const APP_DATA_BUCKET = "app-data";

export { getRuntimeUploadsRoot };

export function getStaticDataPath(filename: string) {
  return join(process.cwd(), "src", "data", filename);
}

export async function ensureRuntimeUploadsDir() {
  const root = getRuntimeUploadsRoot();
  await mkdir(root, { recursive: true });
  return root;
}

async function ensureAppDataBucket() {
  try {
    const { data: buckets, error } = await supabaseServer.storage.listBuckets();
    if (error) throw error;
    if (!buckets?.some((b) => b.id === APP_DATA_BUCKET)) {
      await supabaseServer.storage.createBucket(APP_DATA_BUCKET, { public: false });
    }
  } catch (e) {
    console.warn("Could not ensure app-data bucket:", e);
  }
}

function localFileIsFresh(runtimePath: string, maxAgeMs = 5 * 60 * 1000): boolean {
  try {
    if (!fs.existsSync(runtimePath)) return false;
    return Date.now() - fs.statSync(runtimePath).mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}

export async function readPersistedJson(filename: string): Promise<string | null> {
  const runtimePath = join(getRuntimeUploadsRoot(), filename);

  const readLocal = async (): Promise<string | null> => {
    try {
      if (fs.existsSync(runtimePath)) {
        return await readFile(runtimePath, "utf8");
      }
    } catch {
      // fall through
    }
    return null;
  };

  const localText = await readLocal();
  // Same-instance writes land on disk first. Prefer that copy for a few minutes so
  // GET does not replace it with a stale cloud object (upsert lag / failed upload).
  if (localText && localFileIsFresh(runtimePath)) {
    return localText;
  }

  // In Azure/Vercel, a stale local cache (including an empty wipe leftover) must
  // not hide the cloud copy that other instances wrote.
  if (isCloudDeployment()) {
    try {
      await ensureAppDataBucket();
      const { data, error } = await supabaseServer.storage.from(APP_DATA_BUCKET).download(filename);
      if (!error && data) {
        const text = await data.text();
        const stillFresh = localText && localFileIsFresh(runtimePath);
        if (stillFresh) return localText;
        await ensureRuntimeUploadsDir();
        await writeFile(runtimePath, text, "utf8");
        return text;
      }
    } catch (e) {
      console.warn(`Supabase read failed for ${filename}:`, e);
    }
  }

  if (localText) return localText;

  try {
    const staticPath = getStaticDataPath(filename);
    if (fs.existsSync(staticPath)) {
      const text = await readFile(staticPath, "utf8");
      await ensureRuntimeUploadsDir();
      await writeFile(runtimePath, text, "utf8");
      return text;
    }
  } catch {
    // fall through
  }

  return null;
}

export async function writePersistedJson(filename: string, content: string): Promise<void> {
  await ensureRuntimeUploadsDir();
  const runtimePath = join(getRuntimeUploadsRoot(), filename);
  await writeFile(runtimePath, content, "utf8");

  if (isCloudDeployment()) {
    try {
      await ensureAppDataBucket();
      const { error } = await supabaseServer.storage.from(APP_DATA_BUCKET).upload(filename, content, {
        contentType: "application/json",
        upsert: true,
        cacheControl: "0",
      });
      if (error) throw error;
    } catch (e) {
      console.warn(`Supabase write failed for ${filename}:`, e);
      throw e;
    }
  }
}

/** Nested JSON backups (employee tests). History files are never deleted. */
export async function writePersistedBackup(relativePath: string, content: string): Promise<void> {
  const safePath = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!safePath || safePath.includes("..")) return;

  await ensureRuntimeUploadsDir();
  const runtimePath = join(getRuntimeUploadsRoot(), ...safePath.split("/"));
  await mkdir(dirname(runtimePath), { recursive: true });
  await writeFile(runtimePath, content, "utf8");

  if (isCloudDeployment()) {
    try {
      await ensureAppDataBucket();
      await supabaseServer.storage.from(APP_DATA_BUCKET).upload(safePath, content, {
        contentType: "application/json",
        upsert: true,
      });
    } catch (e) {
      console.warn(`Supabase backup write failed for ${safePath}:`, e);
    }
  }
}

export async function readPersistedBackup(relativePath: string): Promise<string | null> {
  const safePath = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!safePath || safePath.includes("..")) return null;

  if (isCloudDeployment()) {
    try {
      await ensureAppDataBucket();
      const { data, error } = await supabaseServer.storage.from(APP_DATA_BUCKET).download(safePath);
      if (!error && data) return await data.text();
    } catch (e) {
      console.warn(`Supabase backup read failed for ${safePath}:`, e);
    }
  }

  try {
    const runtimePath = join(getRuntimeUploadsRoot(), ...safePath.split("/"));
    if (fs.existsSync(runtimePath)) return await readFile(runtimePath, "utf8");
  } catch {
    // fall through
  }
  return null;
}
