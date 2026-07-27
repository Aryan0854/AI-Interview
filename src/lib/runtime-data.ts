import { join } from "path";
import fs from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { supabaseServer } from "@/lib/db";

const APP_DATA_BUCKET = "app-data";

export function getRuntimeUploadsRoot() {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
}

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

export async function readPersistedJson(filename: string): Promise<string | null> {
  const runtimePath = join(getRuntimeUploadsRoot(), filename);

  try {
    if (fs.existsSync(runtimePath)) {
      return await readFile(runtimePath, "utf8");
    }
  } catch {
    // fall through
  }

  if (process.env.VERCEL === "1") {
    try {
      await ensureAppDataBucket();
      const { data, error } = await supabaseServer.storage.from(APP_DATA_BUCKET).download(filename);
      if (!error && data) {
        const text = await data.text();
        await ensureRuntimeUploadsDir();
        await writeFile(runtimePath, text, "utf8");
        return text;
      }
    } catch (e) {
      console.warn(`Supabase read failed for ${filename}:`, e);
    }
  }

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

  if (process.env.VERCEL === "1") {
    try {
      await ensureAppDataBucket();
      await supabaseServer.storage.from(APP_DATA_BUCKET).upload(filename, content, {
        contentType: "application/json",
        upsert: true,
      });
    } catch (e) {
      console.warn(`Supabase write failed for ${filename}:`, e);
    }
  }
}
