import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { supabaseServer } from "@/lib/db";
import { ensureRuntimeUploadsDir, getRuntimeUploadsRoot } from "@/lib/runtime-data";

const RECORDINGS_BUCKET = "recordings";
const STORAGE_PREFIX = "employee-tests";

function localVideoPath(testId: string) {
  return join(getRuntimeUploadsRoot(), "employee_test_recordings", `${testId}.webm`);
}

async function ensureRecordingsBucket() {
  const { data: buckets, error } = await supabaseServer.storage.listBuckets();
  if (error) throw error;
  if (!buckets?.some((b) => b.id === RECORDINGS_BUCKET)) {
    const { error: createErr } = await supabaseServer.storage.createBucket(RECORDINGS_BUCKET, {
      public: true,
      allowedMimeTypes: ["video/webm", "video/mp4", "video/quicktime"],
    });
    if (createErr) throw createErr;
  }
}

export async function saveEmployeeTestVideo(testId: string, buffer: Buffer): Promise<void> {
  try {
    await ensureRecordingsBucket();
    const { error } = await supabaseServer.storage
      .from(RECORDINGS_BUCKET)
      .upload(`${STORAGE_PREFIX}/${testId}.webm`, buffer, {
        contentType: "video/webm",
        upsert: true,
      });
    if (error) throw error;
    return;
  } catch (storageErr) {
    console.warn("Employee test video Supabase upload failed, using local fallback:", storageErr);
  }

  await ensureRuntimeUploadsDir();
  const dir = join(getRuntimeUploadsRoot(), "employee_test_recordings");
  await mkdir(dir, { recursive: true });
  await writeFile(localVideoPath(testId), buffer);
}

export async function readEmployeeTestVideo(testId: string): Promise<Buffer | null> {
  try {
    const { data, error } = await supabaseServer.storage
      .from(RECORDINGS_BUCKET)
      .download(`${STORAGE_PREFIX}/${testId}.webm`);
    if (!error && data) {
      return Buffer.from(await data.arrayBuffer());
    }
  } catch {
    // fall through to local
  }

  try {
    return await readFile(localVideoPath(testId));
  } catch {
    return null;
  }
}

export async function deleteEmployeeTestVideo(testId: string): Promise<void> {
  try {
    await supabaseServer.storage.from(RECORDINGS_BUCKET).remove([`${STORAGE_PREFIX}/${testId}.webm`]);
  } catch {
    // ignore
  }

  try {
    const { unlink } = await import("fs/promises");
    await unlink(localVideoPath(testId));
  } catch {
    // ignore
  }
}
