import { Decoder, Reader, tools } from "ts-ebml";

/**
 * MediaRecorder WebM files often omit Duration in Segment Info, so native
 * `<video controls>` only show elapsed time (e.g. "0:09") without total length.
 * Rebuild seekable metadata with computed duration so browsers display "0:24 / 11:44".
 */
export function fixWebmDurationBuffer(input: Buffer): Buffer {
  if (input.length < 512) return input;

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
    if (!metadataSize || metadataSize >= input.length) {
      return input;
    }

    const seekable = tools.makeMetadataSeekable(reader.metadatas, duration, reader.cues ?? []);
    return Buffer.concat([Buffer.from(seekable), input.subarray(metadataSize)]);
  } catch (err) {
    console.warn("WebM duration metadata fix failed, using original buffer:", err);
    return input;
  }
}
