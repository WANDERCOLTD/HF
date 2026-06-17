/**
 * Tests for lib/voice/audio-slice.ts (epic #1762, Story D).
 *
 * Pins the contract Story E (PROSODY_AUDIO stage) consumes:
 *   - Validation: window shape, host allow-list, oversize rejection
 *   - WAV header parse: RIFF magic, fmt chunk, PCM-only
 *   - Time→byte mapping: linear, frame-aligned, clamped to data chunk
 *   - HTTP Range fetch: 206 Partial Content, buffer length matches range
 *
 * The integration test fetches a real 30-second slice from a public VAPI
 * recording. It is skipped when `process.env.SKIP_NETWORK_TESTS === "1"`
 * so CI without outbound network can still pass the unit suite.
 */

import { describe, it, expect } from "vitest";
import {
  extractAudioSlice,
  parseWavHeader,
  timeToByteOffset,
  AudioSliceError,
  MAX_SLICE_SECONDS,
  type WavFormat,
} from "@/lib/voice/audio-slice";

const SAMPLE_VAPI_URL =
  "https://storage.vapi.ai/019ead08-4bc4-7000-ab1d-44963300924a-1781019518083-db451a4e-b0b4-435d-aa7e-4e1215a5686d-mono.wav";

/**
 * The global vitest setup at `tests/setup.ts:618` mocks `global.fetch` for
 * the entire suite, so this real-network test is opt-IN via
 * `RUN_NETWORK_TESTS=1`. When ON, we pass the test-acquired real fetch
 * into `extractAudioSlice` via the `fetchImpl` injection so we don't have
 * to fight the global mock.
 */
const RUN_NETWORK = process.env.RUN_NETWORK_TESTS === "1";

/** Build a minimal valid PCM WAV header in memory. Header is 44 bytes:
 * RIFF (12) + fmt (24) + data (8). Followed by `dataLen` bytes of payload. */
function buildWavHeader(opts: {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataLen: number;
}): Uint8Array {
  const { sampleRate, channels, bitsPerSample, dataLen } = opts;
  const bytesPerSample = bitsPerSample / 8;
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const buf = new Uint8Array(44 + dataLen);
  const view = new DataView(buf.buffer);
  // RIFF
  buf.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, 36 + dataLen, true); // ChunkSize
  buf.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
  // fmt
  buf.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // data
  buf.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, dataLen, true);
  return buf;
}

describe("parseWavHeader", () => {
  it("parses a standard 16 kHz mono 16-bit PCM WAV", () => {
    const buf = buildWavHeader({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      dataLen: 64000,
    });
    const fmt = parseWavHeader(buf);
    expect(fmt.audioFormat).toBe(1);
    expect(fmt.sampleRate).toBe(16000);
    expect(fmt.channels).toBe(1);
    expect(fmt.bitsPerSample).toBe(16);
    expect(fmt.dataOffset).toBe(44);
    expect(fmt.dataLength).toBe(64000);
  });

  it("rejects a buffer that is too short for a header", () => {
    expect(() => parseWavHeader(new Uint8Array(10))).toThrow(AudioSliceError);
  });

  it("rejects a non-RIFF buffer", () => {
    const buf = buildWavHeader({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      dataLen: 100,
    });
    buf[0] = 0x58; // corrupt the "R" in "RIFF"
    expect(() => parseWavHeader(buf)).toThrow(/Not a RIFF\/WAVE/);
  });

  it("rejects a non-PCM compression code", () => {
    const buf = buildWavHeader({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      dataLen: 100,
    });
    // Overwrite audioFormat with 7 (mu-law) at offset 20.
    new DataView(buf.buffer).setUint16(20, 7, true);
    expect(() => parseWavHeader(buf)).toThrow(/Unsupported WAV audio format 7/);
  });
});

describe("timeToByteOffset", () => {
  const format16k_mono_16bit: WavFormat = {
    audioFormat: 1,
    channels: 1,
    sampleRate: 16000,
    bitsPerSample: 16,
    dataOffset: 44,
    dataLength: 16000 * 1 * 2 * 60, // 60 seconds of audio
  };

  it("maps 0 sec → first sample byte (dataOffset)", () => {
    expect(timeToByteOffset(0, format16k_mono_16bit)).toBe(44);
  });

  it("maps 1 sec → dataOffset + 32000 (16k samples × 1 ch × 2 bytes)", () => {
    expect(timeToByteOffset(1, format16k_mono_16bit)).toBe(44 + 32000);
  });

  it("maps 30 sec → dataOffset + 960000", () => {
    expect(timeToByteOffset(30, format16k_mono_16bit)).toBe(44 + 960000);
  });

  it("aligns to frame boundary for stereo 16-bit (4 bytes per frame)", () => {
    const stereo: WavFormat = {
      audioFormat: 1,
      channels: 2,
      sampleRate: 16000,
      bitsPerSample: 16,
      dataOffset: 44,
      dataLength: 16000 * 2 * 2 * 60,
    };
    // 0.0001 sec * 64000 bytes/sec = 6.4 → floor → 6 → frame-align to 4
    const result = timeToByteOffset(0.0001, stereo);
    expect((result - 44) % 4).toBe(0);
  });

  it("clamps time beyond data chunk end to data chunk end", () => {
    // 120 sec > 60 sec of data — should clamp.
    const result = timeToByteOffset(120, format16k_mono_16bit);
    expect(result).toBe(44 + format16k_mono_16bit.dataLength);
  });
});

describe("extractAudioSlice — validation", () => {
  const validUrl = "https://storage.vapi.ai/test-file.wav";

  it("rejects negative startSec", async () => {
    await expect(
      extractAudioSlice({ audioUrl: validUrl, startSec: -1, endSec: 30 }),
    ).rejects.toMatchObject({ code: "invalid_window" });
  });

  it("rejects endSec equal to startSec", async () => {
    await expect(
      extractAudioSlice({ audioUrl: validUrl, startSec: 10, endSec: 10 }),
    ).rejects.toMatchObject({ code: "invalid_window" });
  });

  it("rejects endSec less than startSec", async () => {
    await expect(
      extractAudioSlice({ audioUrl: validUrl, startSec: 20, endSec: 5 }),
    ).rejects.toMatchObject({ code: "invalid_window" });
  });

  it("rejects NaN startSec", async () => {
    await expect(
      extractAudioSlice({ audioUrl: validUrl, startSec: Number.NaN, endSec: 10 }),
    ).rejects.toMatchObject({ code: "invalid_window" });
  });

  it("rejects window larger than MAX_SLICE_SECONDS", async () => {
    await expect(
      extractAudioSlice({
        audioUrl: validUrl,
        startSec: 0,
        endSec: MAX_SLICE_SECONDS + 1,
      }),
    ).rejects.toMatchObject({ code: "oversize_window" });
  });

  it("rejects non-https URL", async () => {
    await expect(
      extractAudioSlice({
        audioUrl: "http://storage.vapi.ai/test.wav",
        startSec: 0,
        endSec: 10,
      }),
    ).rejects.toMatchObject({ code: "host_not_allowed" });
  });

  it("rejects non-allowlisted host", async () => {
    await expect(
      extractAudioSlice({
        audioUrl: "https://attacker.example.com/evil.wav",
        startSec: 0,
        endSec: 10,
      }),
    ).rejects.toMatchObject({ code: "host_not_allowed" });
  });

  it("rejects a malformed URL string", async () => {
    await expect(
      extractAudioSlice({ audioUrl: "not-a-url", startSec: 0, endSec: 10 }),
    ).rejects.toMatchObject({ code: "host_not_allowed" });
  });
});

describe("extractAudioSlice — fetch behaviour (mocked)", () => {
  it("issues two Range requests (header then slice) and returns the buffer", async () => {
    const header = buildWavHeader({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      dataLen: 16000 * 2 * 120, // 120s of audio
    });

    const sliceBytes = new Uint8Array(32000); // 1 second @ 16 kHz mono 16-bit
    sliceBytes.fill(0x42);

    const calls: Array<{ url: string; range: string | undefined }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const range =
        init?.headers && typeof init.headers === "object"
          ? (init.headers as Record<string, string>).Range
          : undefined;
      calls.push({ url, range });
      const body = (calls.length === 1 ? header : sliceBytes) as BodyInit;
      return new Response(body, {
        status: 206,
        headers: { "content-type": "audio/wav" },
      });
    };

    const result = await extractAudioSlice({
      audioUrl: "https://storage.vapi.ai/test.wav",
      startSec: 10,
      endSec: 11,
      fetchImpl: fakeFetch,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].range).toBe("bytes=0-4095");
    // 10 sec * 32000 bytes/sec = 320000, +44 header = 320044
    // 11 sec * 32000 bytes/sec = 352000, +44 header = 352044, -1 inclusive = 352043
    expect(calls[1].range).toBe("bytes=320044-352043");
    expect(result.strategy).toBe("byte-range-proxy");
    expect(result.startByte).toBe(320044);
    expect(result.endByte).toBe(352043);
    expect(result.startSec).toBe(10);
    expect(result.endSec).toBe(11);
    expect(result.contentType).toBe("audio/wav");
    expect(result.buffer).toBeDefined();
    expect(result.buffer!.length).toBe(32000);
    expect(result.format.sampleRate).toBe(16000);
    expect(result.format.channels).toBe(1);
  });

  it("throws range_fetch_failed when slice response is non-206", async () => {
    const header = buildWavHeader({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      dataLen: 16000 * 2 * 120,
    });
    let callCount = 0;
    const fakeFetch: typeof fetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(header as BodyInit, { status: 206 });
      }
      return new Response("range not satisfiable", { status: 416 });
    };

    await expect(
      extractAudioSlice({
        audioUrl: "https://storage.vapi.ai/test.wav",
        startSec: 10,
        endSec: 11,
        fetchImpl: fakeFetch,
      }),
    ).rejects.toMatchObject({ code: "range_fetch_failed" });
  });

  it("throws header_fetch_failed when header fetch returns 5xx", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("server error", { status: 500 });

    await expect(
      extractAudioSlice({
        audioUrl: "https://storage.vapi.ai/test.wav",
        startSec: 0,
        endSec: 10,
        fetchImpl: fakeFetch,
      }),
    ).rejects.toMatchObject({ code: "header_fetch_failed" });
  });
});

describe.runIf(RUN_NETWORK)("extractAudioSlice — real VAPI URL", () => {
  it(
    "fetches a real 30-second slice and confirms 206 + correct duration",
    async () => {
      // Bypass the global fetch mock by binding Node's built-in fetch via
      // dynamic import. `undici` ships with Node 22 and exposes `fetch`.
      const { fetch: realFetch } = await import("undici");
      const result = await extractAudioSlice({
        audioUrl: SAMPLE_VAPI_URL,
        startSec: 5,
        endSec: 35,
        fetchImpl: realFetch as unknown as typeof fetch,
      });

      expect(result.strategy).toBe("byte-range-proxy");
      expect(result.format.audioFormat).toBe(1);
      // VAPI's wavs are typically 16 kHz mono. Don't pin the rate exactly
      // because the recording shape may evolve — just sanity-check bounds.
      expect(result.format.sampleRate).toBeGreaterThanOrEqual(8000);
      expect(result.format.sampleRate).toBeLessThanOrEqual(48000);
      expect(result.format.channels).toBeGreaterThanOrEqual(1);
      expect(result.format.channels).toBeLessThanOrEqual(2);

      // Buffer length should equal the inclusive byte range.
      const expectedLen = result.endByte - result.startByte + 1;
      expect(result.buffer!.length).toBe(expectedLen);

      // 30 seconds of audio at the parsed sample rate should equal the
      // buffer length within one frame (rounding).
      const bytesPerSec =
        result.format.sampleRate *
        result.format.channels *
        (result.format.bitsPerSample / 8);
      const expectedBytesForWindow = 30 * bytesPerSec;
      // Allow a frame's worth of slack for the inclusive-range off-by-one.
      const frameBytes = result.format.channels * (result.format.bitsPerSample / 8);
      expect(Math.abs(result.buffer!.length - expectedBytesForWindow)).toBeLessThanOrEqual(
        frameBytes * 2,
      );
    },
    30_000,
  );
});
