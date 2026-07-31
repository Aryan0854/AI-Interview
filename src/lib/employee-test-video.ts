import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { supabaseServer } from "@/lib/db";
import { ensureRuntimeUploadsDir, getRuntimeUploadsRoot } from "@/lib/runtime-data";

const RECORDINGS_BUCKET = "recordings";
const STORAGE_PREFIX = "employee-tests";

export function employeeTestVideoStoragePath(testId: string): string {
  return `${STORAGE_PREFIX}/${testId}.webm`;
}

function localVideoPath(testId: string) {
  return join(getRuntimeUploadsRoot(), "employee_test_recordings", `${testId}.webm`);
}

/**
 * MediaRecorder / upload glitches can leave junk bytes before the EBML header.
 * WebM must start with 1A 45 DF A3 — trim any leading garbage so players can open it.
 */
export function repairWebmBuffer(buffer: Buffer): Buffer {
  if (!buffer.length) return buffer;
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return buffer;
  }

  const limit = Math.min(buffer.length - 4, 512 * 1024);
  for (let i = 1; i < limit; i++) {
    if (
      buffer[i] === 0x1a &&
      buffer[i + 1] === 0x45 &&
      buffer[i + 2] === 0xdf &&
      buffer[i + 3] === 0xa3
    ) {
      console.warn(`Repairing WebM: stripped ${i} leading bytes before EBML header`);
      return buffer.subarray(i);
    }
  }
  return buffer;
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

export async function saveEmployeeTestVideo(testId: string, buffer: Buffer): Promise<boolean> {
  const cleaned = repairWebmBuffer(buffer);
  if (!cleaned.length) return false;

  try {
    await ensureRecordingsBucket();
    const path = employeeTestVideoStoragePath(testId);
    const { error } = await supabaseServer.storage.from(RECORDINGS_BUCKET).upload(path, cleaned, {
      contentType: "video/webm",
      upsert: true,
    });
    if (error) throw error;

    const { data: verify, error: verifyErr } = await supabaseServer.storage
      .from(RECORDINGS_BUCKET)
      .download(path);
    if (verifyErr || !verify) throw verifyErr || new Error("Upload verification failed");
    return true;
  } catch (storageErr) {
    console.warn("Employee test video Supabase upload failed, using local fallback:", storageErr);
  }

  try {
    await ensureRuntimeUploadsDir();
    const dir = join(getRuntimeUploadsRoot(), "employee_test_recordings");
    await mkdir(dir, { recursive: true });
    await writeFile(localVideoPath(testId), cleaned);
    return true;
  } catch (localErr) {
    console.error("Employee test video local save failed:", localErr);
    return false;
  }
}

export async function createEmployeeTestVideoUploadUrl(
  testId: string
): Promise<{ signedUrl: string; path: string } | null> {
  try {
    await ensureRecordingsBucket();
    const path = employeeTestVideoStoragePath(testId);
    const { data, error } = await supabaseServer.storage
      .from(RECORDINGS_BUCKET)
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !data?.signedUrl) throw error || new Error("No signed upload URL");
    return { signedUrl: data.signedUrl, path };
  } catch (err) {
    console.warn("Failed to create signed upload URL for employee test video:", err);
    return null;
  }
}

export function getEmployeeTestVideoAdminUrl(testId: string): string {
  return `/api/admin/employee-tests/${testId}/video`;
}

export function getEmployeeTestVideoPublicUrl(testId: string): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  if (!supabaseUrl.startsWith("http")) return null;
  const path = employeeTestVideoStoragePath(testId);
  return `${supabaseUrl}/storage/v1/object/public/${RECORDINGS_BUCKET}/${path}`;
}

export async function employeeTestVideoExists(testId: string): Promise<boolean> {
  const path = employeeTestVideoStoragePath(testId);
  try {
    const { data, error } = await supabaseServer.storage.from(RECORDINGS_BUCKET).list(STORAGE_PREFIX, {
      search: `${testId}.webm`,
    });
    if (!error && data?.some((f) => f.name === `${testId}.webm`)) return true;
  } catch {
    // fall through
  }

  try {
    const { data, error } = await supabaseServer.storage.from(RECORDINGS_BUCKET).download(path);
    if (!error && data) {
      const buffer = Buffer.from(await data.arrayBuffer());
      return buffer.length > 0;
    }
  } catch {
    // fall through
  }

  try {
    const local = await readFile(localVideoPath(testId));
    return local.length > 0;
  } catch {
    return false;
  }
}

export async function readEmployeeTestVideo(testId: string): Promise<Buffer | null> {
  const path = employeeTestVideoStoragePath(testId);

  try {
    const { data, error } = await supabaseServer.storage.from(RECORDINGS_BUCKET).download(path);
    if (!error && data) {
      const buffer = repairWebmBuffer(Buffer.from(await data.arrayBuffer()));
      if (buffer.length > 0) return buffer;
    }
  } catch {
    // fall through to local / public URL
  }

  const publicUrl = getEmployeeTestVideoPublicUrl(testId);
  if (publicUrl) {
    try {
      const res = await fetch(publicUrl);
      if (res.ok) {
        const buffer = repairWebmBuffer(Buffer.from(await res.arrayBuffer()));
        if (buffer.length > 0) return buffer;
      }
    } catch {
      // fall through
    }
  }

  try {
    const local = repairWebmBuffer(await readFile(localVideoPath(testId)));
    if (local.length > 0) return local;
  } catch {
    // fall through
  }

  return null;
}

export async function deleteEmployeeTestVideo(testId: string): Promise<void> {
  try {
    await supabaseServer.storage
      .from(RECORDINGS_BUCKET)
      .remove([employeeTestVideoStoragePath(testId)]);
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
