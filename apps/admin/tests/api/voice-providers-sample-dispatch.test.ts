/**
 * Tests for `dispatchSample` in the voice-sample route (#1421 Slice B).
 *
 * Pins the dispatch decision tree:
 *   - voiceProvider === "deepgram" + deepgramKey present → Deepgram direct, exact preview
 *   - voiceProvider === "deepgram" + no key → OpenAI fallback, non-exact preview
 *   - voiceProvider === "openai" + no Deepgram key → OpenAI direct, exact preview
 *   - voiceProvider === "11labs" + no key → OpenAI fallback (nova default), non-exact
 *
 * The HTTP envelope (auth, rate limit, body parsing) is enforced
 * separately at the route level — those vitests would need a Next.js
 * request mock and are out of scope for this slice.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock fetch BEFORE importing the route so the Deepgram call is intercepted.
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Mock OpenAI SDK so the fallback path doesn't reach the network.
vi.mock("openai", () => {
  return {
    default: class FakeOpenAI {
      audio = {
        speech: {
          create: vi.fn(async () => ({
            arrayBuffer: async () => new ArrayBuffer(42),
          })),
        },
      };
    },
  };
});

// Need a fake OPENAI key so the fallback doesn't throw "not configured".
beforeEach(() => {
  process.env.OPENAI_HF_MVP_KEY = "test-openai-key";
  fetchMock.mockReset();
});

afterEach(() => {
  delete process.env.OPENAI_HF_MVP_KEY;
});

async function loadDispatch() {
  // Lazy-import after env + mocks are in place.
  const mod = await import(
    "@/app/api/voice-providers/[id]/sample/route"
  );
  return mod.dispatchSample;
}

describe("dispatchSample (#1421 Slice B)", () => {
  it("Deepgram + key → calls Deepgram TTS, returns exact preview", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(99),
    });
    const dispatch = await loadDispatch();
    const r = await dispatch({
      text: "hello",
      voiceProvider: "deepgram",
      voiceId: "asteria",
      deepgramKey: "dg-test-key",
    });
    expect(r.engine).toBe("deepgram");
    expect(r.isExactPreview).toBe(true);
    expect(r.audioBytes.byteLength).toBe(99);
    // Verify the URL shape and auth header.
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("api.deepgram.com");
    expect(String(url)).toContain("model=aura-asteria-en");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Token dg-test-key",
    });
  });

  it("Deepgram + NO key → OpenAI fallback, non-exact preview", async () => {
    const dispatch = await loadDispatch();
    const r = await dispatch({
      text: "hello",
      voiceProvider: "deepgram",
      voiceId: "asteria",
      deepgramKey: null,
    });
    expect(r.engine).toBe("openai");
    expect(r.isExactPreview).toBe(false);
    // No Deepgram fetch attempted.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("OpenAI + NO Deepgram key → OpenAI direct, exact preview", async () => {
    const dispatch = await loadDispatch();
    const r = await dispatch({
      text: "hello",
      voiceProvider: "openai",
      voiceId: "nova",
      deepgramKey: null,
    });
    expect(r.engine).toBe("openai");
    expect(r.isExactPreview).toBe(true);
  });

  it("ElevenLabs + no key → OpenAI fallback (nova), non-exact", async () => {
    const dispatch = await loadDispatch();
    const r = await dispatch({
      text: "hello",
      voiceProvider: "11labs",
      voiceId: "21m00Tcm4TlvDq8ikWAM",
      deepgramKey: null,
    });
    expect(r.engine).toBe("openai");
    expect(r.isExactPreview).toBe(false);
  });

  it("Deepgram 4xx → throws with HTTP status in message", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Invalid API key",
    });
    const dispatch = await loadDispatch();
    await expect(
      dispatch({
        text: "hello",
        voiceProvider: "deepgram",
        voiceId: "asteria",
        deepgramKey: "bad-key",
      }),
    ).rejects.toThrow(/Deepgram TTS returned HTTP 401/);
  });
});
