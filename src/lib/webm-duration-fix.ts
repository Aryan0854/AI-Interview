import { Decoder, Reader, tools } from "ts-ebml";

function isValidWebmHeader(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  );
}

function tailsMatch(original: Buffer, candidate: Buffer, tailBytes = 4096): boolean {
  const compare = Math.min(tailBytes, original.length, candidate.length);
  if (compare <= 0) return false;
  return original.subarray(original.length - compare).equals(candidate.subarray(candidate.length - compare));
}

/**
 * MediaRecorder WebM files often omit Duration in Segment Info, so native
 * `<video controls>` only show elapsed time (e.g. "0:09") without total length.
 * Rebuild seekable metadata with computed duration so browsers display "0:24 / 11:44".
 *
 * Returns the original buffer when repair would risk playback (never corrupt source data).
 */
export function fixWebmDurationBuffer(input: Buffer): Buffer {
  if (input.length < 512 || !isValidWebmHeader(input)) return input;

  try {
    const decoder = new Decoder();
    const reader = new Reader();
    const elms = decoder.decode(Uint8Array.from(input).buffer);
    elms.forEach((elm) => reader.read(elm));
    reader.stop();

    const duration = reader.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      return input;
    }

    const metadataSize = reader.metadataSize;
    if (!metadataSize || metadataSize >= input.length - 64) {
      return input;
    }

    const tail = input.subarray(metadataSize);
    const seekable = tools.makeMetadataSeekable(reader.metadatas, duration, reader.cues ?? []);
    const header = Buffer.from(seekable);
    const fixed = Buffer.concat([header, tail]);

    if (!isValidWebmHeader(fixed)) return input;
    if (fixed.length !== header.length + tail.length) return input;
    if (!tailsMatch(input, fixed)) return input;

    return fixed;
  } catch (err) {
    console.warn("WebM duration metadata fix skipped, using original buffer:", err);
    return input;
  }
}
