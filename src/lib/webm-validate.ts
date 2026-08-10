/** Matroska/WebM Cluster element id */
const CLUSTER_MAGIC = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);

function bufferIndexOf(haystack: Buffer, needle: Buffer, from = 0, to?: number): number {
  const end = to ?? haystack.length;
  const limit = Math.min(end, haystack.length) - needle.length;
  for (let i = Math.max(0, from); i <= limit; i++) {
    if (haystack[i] === needle[0] && haystack.subarray(i, i + needle.length).equals(needle)) {
      return i;
    }
  }
  return -1;
}

export function hasEbmlHeader(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  );
}

/** True when the file contains at least one Cluster (required for playback). */
export function hasWebmClusterData(buffer: Buffer): boolean {
  if (buffer.length < 512) return false;
  const scanLimit = Math.min(buffer.length, 4 * 1024 * 1024);
  return bufferIndexOf(buffer, CLUSTER_MAGIC, 0, scanLimit) >= 0;
}

export function isPlayableWebmBuffer(buffer: Buffer, minBytes = 4096): boolean {
  return (
    buffer.length >= minBytes &&
    hasEbmlHeader(buffer) &&
    hasWebmClusterData(buffer)
  );
}

/** Quick client-side check on the first bytes of a Blob (call before upload). */
export function isPlayableWebmHeaderBytes(bytes: Uint8Array, totalSize: number, minBytes = 4096): boolean {
  if (totalSize < minBytes || bytes.length < 4) return false;
  if (!hasEbmlHeader(Buffer.from(bytes.subarray(0, 4)))) return false;
  if (bytes.length >= 8) {
    const slice = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 65536)));
    if (hasWebmClusterData(slice)) return true;
  }
  return totalSize >= minBytes * 2;
}
