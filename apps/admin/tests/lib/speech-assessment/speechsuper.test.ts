/**
 * SpeechSuper adapter unit tests (#1118).
 *
 * Covers:
 *   - getConfigSchema() declares both sensitive keys + spontaneous mode
 *   - getCapabilities() declares IELTS + spontaneous + prosody
 *   - scoreUploadedAudio computes the two SHA-1 signatures correctly
 *   - scoreUploadedAudio normalises a fixture vendor response with IELTS
 *     scores into NormalisedScoreResult
 *   - scoreUploadedAudio throws when either credential is missing
 *   - scoreUploadedAudio throws on vendor errId
 *
 * Vendor reference: github.com/speechsuper/SpeechSuper-API-Samples
 * (http_samples/python_http_sample/sample.py) — confirmed signature
 * computation: sha1(appKey + timestamp + secretKey).hexdigest() and
 * sha1(appKey + timestamp + userId + secretKey).hexdigest().
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as crypto from "node:crypto";

import { SpeechSuperAdapter } from "@/lib/speech-assessment/providers/speechsuper";

describe("SpeechSuperAdapter", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("declares non-empty getConfigSchema with both sensitive keys", () => {
    const adapter = new SpeechSuperAdapter({}, {});
    const schema = adapter.getConfigSchema();
    const keys = schema.fields.map((f) => f.key);
    expect(keys).toContain("appKey");
    expect(keys).toContain("secretKey");
    const appKey = schema.fields.find((f) => f.key === "appKey");
    const secretKey = schema.fields.find((f) => f.key === "secretKey");
    expect(appKey?.sensitive).toBe(true);
    expect(appKey?.required).toBe(true);
    expect(secretKey?.sensitive).toBe(true);
    expect(secretKey?.required).toBe(true);
  });

  it("declares IELTS + spontaneous + prosody capabilities", () => {
    const adapter = new SpeechSuperAdapter({}, {});
    const caps = adapter.getCapabilities();
    expect(caps.ieltsSupported).toBe(true);
    expect(caps.spontaneousSupported).toBe(true);
    expect(caps.prosodyFeatures).toBe(true);
    expect(caps.acceptsRecordingUrl).toBe(false);
    expect(caps.requiresFileUpload).toBe(true);
  });

  it("computes SHA-1 signatures matching the SpeechSuper sample.py reference", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ errId: 0, result: { ielts: {} } }), {
        status: 200,
      }),
    );

    const fixedNow = 1717000000000; // 2024-05-29T18:26:40Z
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);

    const appKey = "app-123";
    const secretKey = "secret-abc";
    const userId = "guest";
    const timestamp = String(Math.floor(fixedNow / 1000));

    const expectedConnectSig = crypto
      .createHash("sha1")
      .update(`${appKey}${timestamp}${secretKey}`)
      .digest("hex");
    const expectedStartSig = crypto
      .createHash("sha1")
      .update(`${appKey}${timestamp}${userId}${secretKey}`)
      .digest("hex");

    const adapter = new SpeechSuperAdapter(
      { appKey, secretKey },
      { defaultUserId: userId },
    );
    await adapter.scoreUploadedAudio(
      Buffer.from([0x52, 0x49, 0x46, 0x46]),
      "audio/wav",
      "ielts",
    );

    const body = fetchSpy.mock.calls[0]?.[1]?.body as FormData;
    const text = body.get("text");
    expect(typeof text).toBe("string");
    const params = JSON.parse(text as string);
    expect(params.connect.param.app.sig).toBe(expectedConnectSig);
    expect(params.start.param.app.sig).toBe(expectedStartSig);
    expect(params.start.param.app.userId).toBe(userId);
    expect(params.start.param.app.timestamp).toBe(timestamp);
  });

  it("posts to the speak.eval.pro endpoint with Request-Index header", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ errId: 0, result: { ielts: {} } }), {
        status: 200,
      }),
    );

    const adapter = new SpeechSuperAdapter(
      { appKey: "a", secretKey: "s" },
      {},
    );
    await adapter.scoreUploadedAudio(Buffer.from([0]), "audio/wav", "ielts");

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toContain("api.speechsuper.com/speak.eval.pro");
    const headers = (init as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.["Request-Index"]).toBe("0");
  });

  it("normalises IELTS scores from result.ielts into NormalisedScoreResult", async () => {
    const fixture = {
      errId: 0,
      result: {
        ielts: {
          overall: 6.5,
          pronunciation: 7.0,
          fluency: 6.0,
          grammar: 6.5,
          vocabulary: 6.5,
          coherence: 7.0,
        },
        transcription: "Today I would like to talk about...",
      },
    };
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200 }),
    );

    const adapter = new SpeechSuperAdapter(
      { appKey: "a", secretKey: "s" },
      {},
    );
    const result = await adapter.scoreUploadedAudio(
      Buffer.from([0]),
      "audio/wav",
      "ielts",
    );

    expect(result.ielts).toEqual({
      overall: 6.5,
      pronunciation: 7.0,
      fluency: 6.0,
      grammar: 6.5,
      vocabulary: 6.5,
      coherence: 7.0,
    });
    expect(result.transcript).toBe("Today I would like to talk about...");
  });

  it("falls back to top-level scores when result.ielts block is absent", async () => {
    const fixture = {
      errId: 0,
      result: {
        overall: 5.5,
        pronunciation: 6.0,
        fluency: 5.0,
      },
    };
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200 }),
    );

    const adapter = new SpeechSuperAdapter(
      { appKey: "a", secretKey: "s" },
      {},
    );
    const result = await adapter.scoreUploadedAudio(
      Buffer.from([0]),
      "audio/wav",
      "ielts",
    );
    expect(result.ielts?.overall).toBe(5.5);
    expect(result.ielts?.pronunciation).toBe(6.0);
    expect(result.ielts?.fluency).toBe(5.0);
  });

  it("throws when appKey or secretKey is missing", async () => {
    const noAppKey = new SpeechSuperAdapter({ secretKey: "s" }, {});
    await expect(
      noAppKey.scoreUploadedAudio(Buffer.from([0]), "audio/wav", "ielts"),
    ).rejects.toThrow(/appKey and secretKey/);

    const noSecretKey = new SpeechSuperAdapter({ appKey: "a" }, {});
    await expect(
      noSecretKey.scoreUploadedAudio(Buffer.from([0]), "audio/wav", "ielts"),
    ).rejects.toThrow(/appKey and secretKey/);
  });

  it("throws when vendor returns non-zero errId", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ errId: 16385, error: "audio too short" }),
        { status: 200 },
      ),
    );

    const adapter = new SpeechSuperAdapter(
      { appKey: "a", secretKey: "s" },
      {},
    );
    await expect(
      adapter.scoreUploadedAudio(Buffer.from([0]), "audio/wav", "ielts"),
    ).rejects.toThrow(/errId=16385/);
  });
});
