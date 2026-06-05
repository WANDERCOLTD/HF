/**
 * SpeechAce adapter unit tests (#1118).
 *
 * Covers:
 *   - getConfigSchema() + getCapabilities() return non-empty correctness
 *   - scoreUploadedAudio normalises a fixture vendor response into the
 *     NormalisedScoreResult shape with the correct IELTS field mapping
 *   - scoreUploadedAudio throws when apiKey is missing
 *   - scoreUploadedAudio throws on HTTP non-2xx
 *
 * Vendor docs source: https://api-docs.speechace.com (v9 endpoint).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { SpeechAceAdapter } from "@/lib/speech-assessment/providers/speechace";

describe("SpeechAceAdapter", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("declares non-empty getConfigSchema", () => {
    const adapter = new SpeechAceAdapter({}, {});
    const schema = adapter.getConfigSchema();
    expect(schema.fields.length).toBeGreaterThan(0);
    const keys = schema.fields.map((f) => f.key);
    expect(keys).toContain("apiKey");
    expect(keys).toContain("dialect");
  });

  it("marks apiKey as sensitive and required", () => {
    const adapter = new SpeechAceAdapter({}, {});
    const schema = adapter.getConfigSchema();
    const apiKey = schema.fields.find((f) => f.key === "apiKey");
    expect(apiKey?.sensitive).toBe(true);
    expect(apiKey?.required).toBe(true);
  });

  it("declares IELTS + spontaneous + upload-only capabilities", () => {
    const adapter = new SpeechAceAdapter({}, {});
    const caps = adapter.getCapabilities();
    expect(caps.ieltsSupported).toBe(true);
    expect(caps.spontaneousSupported).toBe(true);
    expect(caps.acceptsRecordingUrl).toBe(false);
    expect(caps.requiresFileUpload).toBe(true);
  });

  it("scoreUploadedAudio normalises IELTS scores from speech_score.ielts_score", async () => {
    const fixture = {
      status: "success",
      speech_score: {
        ielts_score: {
          overall: 7.5,
          pronunciation: 8.0,
          fluency: 7.0,
          grammar: 7.5,
          vocab: 7.0,
          coherence: 8.0,
        },
        transcript: "I think the weather today is...",
      },
    };
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const adapter = new SpeechAceAdapter(
      { apiKey: "test-key" },
      { dialect: "en-gb" },
    );
    const buffer = Buffer.from([0x52, 0x49, 0x46, 0x46]);
    const result = await adapter.scoreUploadedAudio(buffer, "audio/wav", "ielts");

    expect(result.ielts).toEqual({
      overall: 7.5,
      pronunciation: 8.0,
      fluency: 7.0,
      grammar: 7.5,
      vocabulary: 7.0,
      coherence: 8.0,
    });
    expect(result.transcript).toBe("I think the weather today is...");
    expect(result.raw).toEqual(fixture);
  });

  it("passes apiKey and dialect as query parameters", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ status: "success", speech_score: {} }), {
        status: 200,
      }),
    );

    const adapter = new SpeechAceAdapter(
      { apiKey: "test-key-123" },
      { dialect: "en-gb" },
    );
    await adapter.scoreUploadedAudio(Buffer.from([0]), "audio/wav", "ielts");

    const calledUrl = fetchSpy.mock.calls[0]?.[0]?.toString() ?? "";
    expect(calledUrl).toContain("key=test-key-123");
    expect(calledUrl).toContain("dialect=en-gb");
  });

  it("throws when apiKey is missing", async () => {
    const adapter = new SpeechAceAdapter({}, {});
    await expect(
      adapter.scoreUploadedAudio(Buffer.from([0]), "audio/wav", "ielts"),
    ).rejects.toThrow(/apiKey is not configured/);
  });

  it("throws on HTTP non-2xx", async () => {
    fetchSpy.mockResolvedValue(
      new Response("unauthorised", { status: 401 }),
    );

    const adapter = new SpeechAceAdapter({ apiKey: "bad-key" }, {});
    await expect(
      adapter.scoreUploadedAudio(Buffer.from([0]), "audio/wav", "ielts"),
    ).rejects.toThrow(/HTTP 401/);
  });

  it("throws when vendor returns a non-success status string", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ status: "audio_too_short" }), {
        status: 200,
      }),
    );

    const adapter = new SpeechAceAdapter({ apiKey: "test" }, {});
    await expect(
      adapter.scoreUploadedAudio(Buffer.from([0]), "audio/wav", "ielts"),
    ).rejects.toThrow(/audio_too_short/);
  });
});
