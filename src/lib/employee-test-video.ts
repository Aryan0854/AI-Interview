import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { supabaseServer } from "@/lib/db";
import { ensureRuntimeUploadsDir, getRuntimeUploadsRoot } from "@/lib/runtime-data";
import {
  hasEbmlHeader,
  hasWebmClusterData,
  isPlayableWebmBuffer,
} from "@/lib/webm-validate";
import { fixWebmDurationBuffer } from "@/lib/webm-duration-fix";

/** Avoid re-parsing WebM on every byte-range request during playback. */
const preparedVideoCache = new Map<string, Buffer>();
const PREPARED_VIDEO_CACHE_MAX = 12;

function rememberPreparedVideo(testId: string, buffer: Buffer): Buffer {
  if (preparedVideoCache.size >= PREPARED_VIDEO_CACHE_MAX) {
    const oldest = preparedVideoCache.keys().next().value;
    if (oldest) preparedVideoCache.delete(oldest);
  }
  preparedVideoCache.set(testId, buffer);
  return buffer;
}

/** Trim junk and add seekable duration metadata for browser `<video>` (serve path only). */
export function prepareWebmForPlayback(buffer: Buffer): Buffer {
  const repaired = repairWebmBuffer(buffer);
  if (!isPlayableWebmBuffer(repaired)) return repaired;
  return fixWebmDurationBuffer(repaired);
}

/** Validate + trim before persisting to Supabase/local disk. */
export function prepareWebmForStorage(buffer: Buffer): Buffer | null {
  const cleaned = repairWebmBuffer(buffer);
  if (!isPlayableWebmBuffer(cleaned)) return null;
  return cleaned;
}

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

const MIN_WEBM_BYTES = 4096;

export function isValidWebmBuffer(buffer: Buffer): boolean {
  const repaired = repairWebmBuffer(buffer);
  return isPlayableWebmBuffer(repaired, MIN_WEBM_BYTES);
}

export { isPlayableWebmBuffer, hasWebmClusterData, hasEbmlHeader };

/** One storage list call — used to mark which tests have a real recording file. */
export async function listEmployeeTestRecordingIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const { data, error } = await supabaseServer.storage.from(RECORDINGS_BUCKET).list(STORAGE_PREFIX, {
      limit: 1000,
    });
    if (error) throw error;
    for (const file of data ?? []) {
      const name = file.name ?? "";
      const fileSize = (file as { metadata?: { size?: number } }).metadata?.size;
      if (
        name.endsWith(".webm") &&
        (fileSize == null || fileSize >= MIN_WEBM_BYTES)
      ) {
        ids.add(name.slice(0, -".webm".length));
      }
    }
  } catch (err) {
    console.warn("Could not list employee test recordings in storage:", err);
  }

  try {
    const dir = join(getRuntimeUploadsRoot(), "employee_test_recordings");
    const { readdir } = await import("fs/promises");
    const files = await readdir(dir);
    for (const name of files) {
      if (name.endsWith(".webm")) {
        ids.add(name.slice(0, -".webm".length));
      }
    }
  } catch {
    // no local recordings dir
  }

  return ids;
}

async function downloadFromStorage(path: string): Promise<Buffer | null> {
  try {
    const { data, error } = await supabaseServer.storage.from(RECORDINGS_BUCKET).download(path);
    if (!error && data) {
      const buffer = repairWebmBuffer(Buffer.from(await data.arrayBuffer()));
      if (isValidWebmBuffer(buffer)) return buffer;
    }
  } catch {
    // fall through
  }

  try {
    const { data, error } = await supabaseServer.storage
      .from(RECORDINGS_BUCKET)
      .createSignedUrl(path, 3600);
    if (!error && data?.signedUrl) {
      const res = await fetch(data.signedUrl);
      if (res.ok) {
        const buffer = repairWebmBuffer(Buffer.from(await res.arrayBuffer()));
        if (isValidWebmBuffer(buffer)) return buffer;
      }
    }
  } catch {
    // fall through
  }

  return null;
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

async function removeFromStorage(path: string): Promise<void> {
  try {
    await supabaseServer.storage.from(RECORDINGS_BUCKET).remove([path]);
  } catch {
    // ignore
  }
}

export async function saveEmployeeTestVideo(testId: string, buffer: Buffer): Promise<boolean> {
  const cleaned = prepareWebmForStorage(buffer);
  if (!cleaned) {
    console.warn(
      `Employee test video rejected for ${testId}: invalid or unplayable WebM (${buffer.length} bytes, cluster=${hasWebmClusterData(repairWebmBuffer(buffer))})`
    );
    return false;
  }

  try {
    await ensureRecordingsBucket();
    const path = employeeTestVideoStoragePath(testId);
    const { error } = await supabaseServer.storage.from(RECORDINGS_BUCKET).upload(path, cleaned, {
      contentType: "video/webm",
      upsert: true,
      cacheControl: "3600",
    });
    if (error) throw error;

    const { data: verify, error: verifyErr } = await supabaseServer.storage
      .from(RECORDINGS_BUCKET)
      .download(path);
    if (verifyErr || !verify) throw verifyErr || new Error("Upload verification failed");

    const verifyBuffer = prepareWebmForStorage(repairWebmBuffer(Buffer.from(await verify.arrayBuffer())));
    if (!verifyBuffer || verifyBuffer.length < cleaned.length * 0.85) {
      console.warn(`Employee test video verify failed for ${testId}: size or playback check`);
      await removeFromStorage(path);
      return false;
    }

    rememberPreparedVideo(testId, verifyBuffer);
    return true;
  } catch (storageErr) {
    console.warn("Employee test video Supabase upload failed, using local fallback:", storageErr);
  }

  try {
    await ensureRuntimeUploadsDir();
    const dir = join(getRuntimeUploadsRoot(), "employee_test_recordings");
    await mkdir(dir, { recursive: true });
    await writeFile(localVideoPath(testId), cleaned);
    rememberPreparedVideo(testId, cleaned);
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

async function readEmployeeTestVideoRaw(testId: string): Promise<Buffer | null> {
  const path = employeeTestVideoStoragePath(testId);

  const fromStorage = await downloadFromStorage(path);
  if (fromStorage) return fromStorage;

  const publicUrl = getEmployeeTestVideoPublicUrl(testId);
  if (publicUrl) {
    try {
      const res = await fetch(publicUrl);
      if (res.ok) {
        const buffer = repairWebmBuffer(Buffer.from(await res.arrayBuffer()));
        if (isValidWebmBuffer(buffer)) return buffer;
      }
    } catch {
      // fall through
    }
  }

  try {
    const local = repairWebmBuffer(await readFile(localVideoPath(testId)));
    if (isValidWebmBuffer(local)) return local;
  } catch {
    // fall through
  }

  return null;
}

export async function readEmployeeTestVideo(testId: string): Promise<Buffer | null> {
  const cached = preparedVideoCache.get(testId);
  if (cached) return cached;

  const raw = await readEmployeeTestVideoRaw(testId);
  if (!raw) return null;

  const forPlayback = prepareWebmForPlayback(raw);
  if (!isPlayableWebmBuffer(forPlayback)) return null;

  return rememberPreparedVideo(testId, forPlayback);
}

export async function deleteEmployeeTestVideo(testId: string): Promise<void> {
  preparedVideoCache.delete(testId);
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
