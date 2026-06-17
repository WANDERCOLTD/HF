/**
 * Audio-slice extraction helper for epic #1762 (audio-snippet per-segment
 * analysis). Given a VAPI recording URL + `[startSec, endSec)` window,
 * produces a bounded audio slice ready to hand to an external prosody
 * service in Story E.
 *
 * Strategy is **byte-range proxy** — we read the WAV header, compute the
 * PCM byte offsets for the time window, and fetch a Range-bounded slice.
 * Decision rationale and alternatives in
 * `docs/decisions/2026-06-17-audio-slice-strategy.md`.
 *
 * Window semantics match Story B's `turnsInWindow` (transcript-detailed.ts):
 * half-open `[startSec, endSec)`, validated before any network call.
 *
 * Allow-listed host: VAPI's CDN-fronted storage only. Arbitrary URLs are
 * rejected — this descriptor is shipped to external services downstream
 * and must never leak an attacker-controlled origin.
 */

/** Maximum slice window. Long enough for IELTS Part 2 monologue + buffer. */
export const MAX_SLICE_SECONDS = 180;

/** Host allow-list. VAPI's storage CDN is the only producer today. */
const ALLOWED_HOSTS = new Set<string>(["storage.vapi.ai"]);

/** WAV header parse needs at most this many bytes for the `fmt ` chunk + a
 * worst-case `LIST INFO` block before `data`. 4 KB is safely conservative. */
const WAV_HEADER_PROBE_BYTES = 4096;

export interface AudioSlice {
  /** Slice bytes — present for `byte-range-proxy` (we fetched them). */
  buffer?: Uint8Array;
  /** Source URL — always present so downstream can re-fetch / delegate. */
  url: string;
  /** Inclusive byte range of the slice on the source. HTTP Range semantics. */
  startByte: number;
  endByte: number;
  /** Echo of the validated input window for callers that thread it through. */
  startSec: number;
  endSec: number;
  /** MIME type. Today always `audio/wav`. */
  contentType: string;
  /** Strategy discriminator. Story E branches on this. */
  strategy: "byte-range-proxy" | "ffmpeg-server" | "signed-slice";
  /** Parsed WAV format — useful for Story E to validate against service expectations. */
  format: WavFormat;
}

export interface AudioSliceOptions {
  audioUrl: string;
  startSec: number;
  endSec: number;
  /** Override the fetch implementation for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface WavFormat {
  /** RIFF audio format code. 1 = PCM. Others reject. */
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  /** Byte offset of the first sample (i.e. after `data` chunk header). */
  dataOffset: number;
  /** Length in bytes of the `data` chunk payload. */
  dataLength: number;
}

export class AudioSliceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_window"
      | "host_not_allowed"
      | "oversize_window"
      | "header_fetch_failed"
      | "header_parse_failed"
      | "unsupported_format"
      | "range_fetch_failed",
  ) {
    super(message);
    this.name = "AudioSliceError";
  }
}

/**
 * Parse the RIFF/WAVE header from a buffer starting at byte 0. Returns the
 * format descriptor + offsets needed for time→byte mapping.
 *
 * Validates:
 *   - "RIFF" magic at offset 0
 *   - "WAVE" magic at offset 8
 *   - `fmt ` chunk found and at least 16 bytes
 *   - `data` chunk found
 *   - `audioFormat === 1` (PCM) — the byte-range strategy relies on
 *     linear byte↔time mapping, which only holds for uncompressed PCM
 */
export function parseWavHeader(header: Uint8Array): WavFormat {
  if (header.length < 44) {
    throw new AudioSliceError("WAV header too short", "header_parse_failed");
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

  const riff = String.fromCharCode(header[0], header[1], header[2], header[3]);
  const wave = String.fromCharCode(header[8], header[9], header[10], header[11]);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new AudioSliceError(
      `Not a RIFF/WAVE file (magic: ${riff}/${wave})`,
      "header_parse_failed",
    );
  }

  let cursor = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null =
    null;
  let dataOffset = -1;
  let dataLength = -1;

  while (cursor + 8 <= header.length) {
    const chunkId = String.fromCharCode(
      header[cursor],
      header[cursor + 1],
      header[cursor + 2],
      header[cursor + 3],
    );
    const chunkSize = view.getUint32(cursor + 4, true);
    const chunkBodyStart = cursor + 8;

    if (chunkId === "fmt ") {
      if (chunkSize < 16 || chunkBodyStart + 16 > header.length) {
        throw new AudioSliceError("fmt chunk truncated", "header_parse_failed");
      }
      fmt = {
        audioFormat: view.getUint16(chunkBodyStart, true),
        channels: view.getUint16(chunkBodyStart + 2, true),
        sampleRate: view.getUint32(chunkBodyStart + 4, true),
        bitsPerSample: view.getUint16(chunkBodyStart + 14, true),
      };
    } else if (chunkId === "data") {
      dataOffset = chunkBodyStart;
      dataLength = chunkSize;
      break;
    }

    // RIFF chunks are word-aligned: an odd chunkSize is padded with one byte.
    cursor = chunkBodyStart + chunkSize + (chunkSize % 2);
  }

  if (!fmt) {
    throw new AudioSliceError("No fmt chunk found in WAV header", "header_parse_failed");
  }
  if (dataOffset < 0) {
    throw new AudioSliceError(
      "No data chunk found in first 4 KB — WAV header is unusually long",
      "header_parse_failed",
    );
  }
  if (fmt.audioFormat !== 1) {
    throw new AudioSliceError(
      `Unsupported WAV audio format ${fmt.audioFormat} (only PCM=1 supported by byte-range strategy)`,
      "unsupported_format",
    );
  }
  if (fmt.channels < 1 || fmt.channels > 8) {
    throw new AudioSliceError(
      `Implausible channel count: ${fmt.channels}`,
      "header_parse_failed",
    );
  }
  if (fmt.sampleRate < 8000 || fmt.sampleRate > 192000) {
    throw new AudioSliceError(
      `Implausible sample rate: ${fmt.sampleRate}`,
      "header_parse_failed",
    );
  }
  if (![8, 16, 24, 32].includes(fmt.bitsPerSample)) {
    throw new AudioSliceError(
      `Implausible bits-per-sample: ${fmt.bitsPerSample}`,
      "header_parse_failed",
    );
  }

  return {
    audioFormat: fmt.audioFormat,
    channels: fmt.channels,
    sampleRate: fmt.sampleRate,
    bitsPerSample: fmt.bitsPerSample,
    dataOffset,
    dataLength,
  };
}

/**
 * Map a time offset (seconds) within a PCM WAV to an absolute byte position
 * in the file. Result is clamped to `[dataOffset, dataOffset + dataLength)`
 * so a window that overruns the recording's end produces a valid (truncated)
 * slice rather than a 416 Range Not Satisfiable.
 *
 * The mapping is sample-aligned — we never land mid-sample, which would
 * shift channel parity for stereo.
 */
export function timeToByteOffset(timeSec: number, format: WavFormat): number {
  const bytesPerSample = format.bitsPerSample / 8;
  const bytesPerFrame = bytesPerSample * format.channels;
  const bytesPerSec = bytesPerFrame * format.sampleRate;
  const raw = Math.floor(timeSec * bytesPerSec);
  // Round DOWN to a frame boundary so channel order is preserved.
  const frameAligned = raw - (raw % bytesPerFrame);
  const absolute = format.dataOffset + frameAligned;
  const clampedHigh = Math.min(absolute, format.dataOffset + format.dataLength);
  const clampedLow = Math.max(format.dataOffset, clampedHigh);
  return clampedLow;
}

function validateOptions(opts: AudioSliceOptions): void {
  if (!Number.isFinite(opts.startSec) || opts.startSec < 0) {
    throw new AudioSliceError(
      `startSec must be >= 0 (got ${opts.startSec})`,
      "invalid_window",
    );
  }
  if (!Number.isFinite(opts.endSec) || opts.endSec <= opts.startSec) {
    throw new AudioSliceError(
      `endSec must be > startSec (got start=${opts.startSec} end=${opts.endSec})`,
      "invalid_window",
    );
  }
  const window = opts.endSec - opts.startSec;
  if (window > MAX_SLICE_SECONDS) {
    throw new AudioSliceError(
      `Slice window ${window.toFixed(1)}s exceeds MAX_SLICE_SECONDS=${MAX_SLICE_SECONDS}`,
      "oversize_window",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(opts.audioUrl);
  } catch {
    throw new AudioSliceError(
      `audioUrl is not a valid URL: ${opts.audioUrl}`,
      "host_not_allowed",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new AudioSliceError(
      `audioUrl must be https (got ${parsed.protocol})`,
      "host_not_allowed",
    );
  }
  if (!ALLOWED_HOSTS.has(parsed.host)) {
    throw new AudioSliceError(
      `audioUrl host '${parsed.host}' is not in the allow-list`,
      "host_not_allowed",
    );
  }
}

/**
 * Extract a bounded audio slice from a VAPI recording URL.
 *
 * Strategy: byte-range proxy. We fetch the WAV header via a small Range
 * request, compute time→byte offsets, then fetch the slice via a second
 * Range request. Both bytes and source URL are returned so Story E can
 * either ship the buffer or delegate to a Range-aware service.
 *
 * @throws AudioSliceError on validation failure or network error.
 */
export async function extractAudioSlice(opts: AudioSliceOptions): Promise<AudioSlice> {
  validateOptions(opts);

  const fetchImpl = opts.fetchImpl ?? fetch;

  // Step 1: read the WAV header. We need sample rate + channels + bits to
  // compute byte offsets.
  const headerEnd = WAV_HEADER_PROBE_BYTES - 1;
  let headerResponse: Response;
  try {
    headerResponse = await fetchImpl(opts.audioUrl, {
      headers: { Range: `bytes=0-${headerEnd}` },
    });
  } catch (err) {
    throw new AudioSliceError(
      `Header fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      "header_fetch_failed",
    );
  }
  if (headerResponse.status !== 206 && headerResponse.status !== 200) {
    throw new AudioSliceError(
      `Header fetch returned ${headerResponse.status} (expected 206 or 200)`,
      "header_fetch_failed",
    );
  }
  const headerBuf = new Uint8Array(await headerResponse.arrayBuffer());
  const format = parseWavHeader(headerBuf);

  // Step 2: compute byte range for the time window.
  const startByte = timeToByteOffset(opts.startSec, format);
  // HTTP Range is INCLUSIVE on both ends. The end byte is the last byte to
  // return, not the one-past-end. Subtract 1 from the exclusive offset.
  const endByteExclusive = timeToByteOffset(opts.endSec, format);
  const endByte = Math.max(startByte, endByteExclusive - 1);

  // Step 3: fetch the slice.
  let sliceResponse: Response;
  try {
    sliceResponse = await fetchImpl(opts.audioUrl, {
      headers: { Range: `bytes=${startByte}-${endByte}` },
    });
  } catch (err) {
    throw new AudioSliceError(
      `Slice fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      "range_fetch_failed",
    );
  }
  if (sliceResponse.status !== 206 && sliceResponse.status !== 200) {
    throw new AudioSliceError(
      `Slice fetch returned ${sliceResponse.status} (expected 206)`,
      "range_fetch_failed",
    );
  }
  const buffer = new Uint8Array(await sliceResponse.arrayBuffer());

  return {
    buffer,
    url: opts.audioUrl,
    startByte,
    endByte,
    startSec: opts.startSec,
    endSec: opts.endSec,
    contentType: sliceResponse.headers.get("content-type") ?? "audio/wav",
    strategy: "byte-range-proxy",
    format,
  };
}
