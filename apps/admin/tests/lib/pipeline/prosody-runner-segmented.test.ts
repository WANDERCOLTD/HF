/**
 * #1870 — Segmented PROSODY runner (consume Stories B/C/D).
 *
 * Defends:
 *   - No phaseBoundaries → byte-identical behaviour to whole-call path
 *     (pre-#1870 baseline preserved)
 *   - 1-phase boundary → segmented path NOT taken (needs >= 2)
 *   - 3-phase IELTS Mock → 3 adapter invocations + per-phase envelopes +
 *     top-level aggregate = MEAN of successful phases
 *   - Adapter throws on phase 2 of 3 → phases 1 + 3 succeed, phase 2 has
 *     mode:"unavailable", aggregate uses only successful phases
 *   - boundaries.length > cap → AppLog + whole-call fallback (one
 *     invocation, not N)
 *   - 3-phase general mode → 3 invocations, top-level aggregate is
 *     stub-aware mean across general signals
 *
 * Namespace: `segmentKey` writes use `phase:<phaseKey>` prefix per
 * #1872 Option 2. This test pins the runner-side envelope shape; the
 * consumer-side write is pinned in
 * `prosody-consumer-segmented.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionMetadata } from "@/lib/types/json-fields";

// ── Mocks ─────────────────────────────────────────────────

const mockCallFindUnique = vi.fn();
const mockCallUpdate = vi.fn();
const mockPlaybookFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    call: { findUnique: mockCallFindUnique, update: mockCallUpdate },
    playbook: { findUnique: mockPlaybookFindUnique },
  },
}));

const mockGetVoiceSystemSettings = vi.fn();
vi.mock("@/lib/voice/system-settings", () => ({
  getVoiceSystemSettings: () => mockGetVoiceSystemSettings(),
}));

const mockResolveProvider = vi.fn();
const mockGetProvider = vi.fn();
vi.mock("@/lib/voice/resolve-speech-assessment-provider", () => ({
  resolveSpeechAssessmentProviderForCall: (...args: unknown[]) =>
    mockResolveProvider(...args),
}));
vi.mock("@/lib/speech-assessment/provider-factory", () => ({
  getSpeechAssessmentProvider: (...args: unknown[]) =>
    mockGetProvider(...args),
}));

vi.mock("@/lib/voice/telemetry", () => ({
  logVoiceEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/pipeline/adaptive-loop-invariants", () => ({
  recordIAL4ProsodySkip: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
}));

// Mock audio-slice so we can stub the buffer return without doing HTTP.
const mockExtractAudioSlice = vi.fn();
vi.mock("@/lib/voice/audio-slice", async () => {
  const actual = await vi.importActual<typeof import("@/lib/voice/audio-slice")>(
    "@/lib/voice/audio-slice",
  );
  return {
    ...actual,
    extractAudioSlice: (...args: unknown[]) => mockExtractAudioSlice(...args),
  };
});

// ── Helpers ───────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockCallUpdate.mockResolvedValue({});
  mockGetVoiceSystemSettings.mockResolvedValue({
    vendorTimeoutMs: 30000,
    fallbackOnAdapterError: "throw",
    maxCostPerCallUsd: null,
    auditRetentionDays: 90,
    defaultProviderSlug: "",
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
    voicemailDetectionEnabled: false,
    endCallPhrases: [],
    maxSegmentsPerCall: 5,
  });
  // Default segmented branch — return a tiny buffer for each slice call.
  mockExtractAudioSlice.mockImplementation(async () => ({
    buffer: new Uint8Array(8),
    url: "https://storage.vapi.ai/x.wav",
    startByte: 0,
    endByte: 7,
    startSec: 0,
    endSec: 10,
    contentType: "audio/wav",
    strategy: "byte-range-proxy" as const,
    format: {
      audioFormat: 1,
      channels: 1,
      sampleRate: 16000,
      bitsPerSample: 16,
      dataOffset: 44,
      dataLength: 1000,
    },
  }));
});

interface CallRowOverrides {
  stereoRecordingUrl?: string | null;
  playbookId?: string | null;
  voiceProsody?: unknown;
  phaseBoundaries?: SessionMetadata["phaseBoundaries"];
}

const callRow = (overrides: CallRowOverrides) => {
  const metadata: SessionMetadata = overrides.phaseBoundaries
    ? { phaseBoundaries: overrides.phaseBoundaries }
    : {};
  mockCallFindUnique.mockResolvedValue({
    id: "c1",
    stereoRecordingUrl:
      overrides.stereoRecordingUrl === undefined
        ? "https://storage.vapi.ai/abc.wav"
        : overrides.stereoRecordingUrl,
    playbookId: overrides.playbookId ?? "pb-ielts-v1",
    voiceProsody: overrides.voiceProsody ?? null,
    session: overrides.phaseBoundaries
      ? { metadata: metadata as unknown as object }
      : { metadata: null },
  });
};

const playbookTier = (tierPresetId: string | null) => {
  mockPlaybookFindUnique.mockResolvedValue({
    config: tierPresetId ? { tierPresetId } : {},
  });
};

/**
 * Adapter stub that returns per-invocation IELTS scores, allowing tests
 * to assert N invocations + per-phase envelope shape.
 */
const ieltsAdapter = (perCallResults: number[]) => {
  let i = 0;
  const scoreUploadedAudio = vi.fn(async () => {
    const overall = perCallResults[i++];
    return {
      ielts: {
        overall,
        pronunciation: overall,
        fluency: overall,
        vocabulary: overall,
        grammar: overall,
      },
      raw: {},
    };
  });
  mockResolveProvider.mockResolvedValue({ slug: "speechace", isFallback: false });
  mockGetProvider.mockResolvedValue({
    slug: "speechace",
    scoreUploadedAudio,
  });
  return scoreUploadedAudio;
};

const stubFetch = () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    headers: { get: () => "audio/wav" },
  }) as unknown as typeof fetch;
};

// ── Tests ─────────────────────────────────────────────────

describe("runProsodyStage — no phaseBoundaries → byte-identical whole-call (#1870)", () => {
  it("calls vendor once and writes no bySegment when boundaries absent", async () => {
    callRow({});
    playbookTier("ielts-speaking");
    stubFetch();
    const scorer = ieltsAdapter([6.5]);
    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });
    expect(scorer).toHaveBeenCalledTimes(1);
    expect(result.envelope.mode).toBe("ielts");
    if (result.envelope.mode === "ielts") {
      expect(result.envelope.ieltsScores?.overall).toBe(6.5);
    }
    expect(result.envelope.bySegment).toBeUndefined();
    expect(mockExtractAudioSlice).not.toHaveBeenCalled();
  });
});

describe("runProsodyStage — 1-phase boundary degenerates to whole-call (#1870)", () => {
  it("single boundary is treated as whole-call (segmented requires >= 2)", async () => {
    callRow({
      phaseBoundaries: [{ phase: "p1", startSec: 0, endSec: 30 }],
    });
    playbookTier("ielts-speaking");
    stubFetch();
    const scorer = ieltsAdapter([7.0]);
    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });
    expect(scorer).toHaveBeenCalledTimes(1);
    expect(result.envelope.bySegment).toBeUndefined();
    expect(mockExtractAudioSlice).not.toHaveBeenCalled();
  });
});

describe("runProsodyStage — 3-phase IELTS Mock (#1870)", () => {
  it("invokes adapter 3 times, writes per-phase envelopes, aggregates by mean", async () => {
    callRow({
      phaseBoundaries: [
        { phase: "p1", startSec: 0, endSec: 30 },
        { phase: "p2_monologue", startSec: 30, endSec: 90 },
        { phase: "p3", startSec: 90, endSec: 150 },
      ],
    });
    playbookTier("ielts-speaking");
    stubFetch();
    const scorer = ieltsAdapter([6.0, 7.0, 8.0]);
    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });

    expect(scorer).toHaveBeenCalledTimes(3);
    expect(mockExtractAudioSlice).toHaveBeenCalledTimes(3);
    expect(result.envelope.mode).toBe("ielts");
    expect(result.envelope.bySegment).toBeDefined();
    expect(Object.keys(result.envelope.bySegment ?? {})).toEqual([
      "phase:p1",
      "phase:p2_monologue",
      "phase:p3",
    ]);
    // Top-level aggregate = mean(6, 7, 8) = 7
    if (result.envelope.mode === "ielts") {
      expect(result.envelope.ieltsScores?.overall).toBe(7);
      expect(result.envelope.ieltsScores?.pronunciation).toBe(7);
    }
    // Per-phase preserves the raw band
    const seg = result.envelope.bySegment ?? {};
    expect(seg["phase:p1"]).toMatchObject({ mode: "ielts" });
    if (seg["phase:p1"]?.mode === "ielts") {
      expect(seg["phase:p1"].ieltsScores.overall).toBe(6);
    }
  });
});

describe("runProsodyStage — partial-failure tolerance (#1870)", () => {
  it("adapter throws on phase 2 of 3 → sibling phases continue, aggregate uses successes only", async () => {
    callRow({
      phaseBoundaries: [
        { phase: "p1", startSec: 0, endSec: 30 },
        { phase: "p2_monologue", startSec: 30, endSec: 90 },
        { phase: "p3", startSec: 90, endSec: 150 },
      ],
    });
    playbookTier("ielts-speaking");
    stubFetch();
    let i = 0;
    const perCall: Array<() => Promise<unknown>> = [
      async () => ({
        ielts: { overall: 6, pronunciation: 6, fluency: 6, vocabulary: 6, grammar: 6 },
        raw: {},
      }),
      async () => {
        throw new Error("vendor 502");
      },
      async () => ({
        ielts: { overall: 8, pronunciation: 8, fluency: 8, vocabulary: 8, grammar: 8 },
        raw: {},
      }),
    ];
    const scorer = vi.fn(async () => perCall[i++]());
    mockResolveProvider.mockResolvedValue({ slug: "speechace", isFallback: false });
    mockGetProvider.mockResolvedValue({ slug: "speechace", scoreUploadedAudio: scorer });

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });

    expect(scorer).toHaveBeenCalledTimes(3);
    const seg = result.envelope.bySegment ?? {};
    expect(seg["phase:p1"]?.mode).toBe("ielts");
    expect(seg["phase:p2_monologue"]?.mode).toBe("unavailable");
    expect(seg["phase:p3"]?.mode).toBe("ielts");
    // Top-level aggregate uses 6 and 8 only → mean = 7
    if (result.envelope.mode === "ielts") {
      expect(result.envelope.ieltsScores?.overall).toBe(7);
    }
  });
});

describe("runProsodyStage — cost cap (#1870)", () => {
  it("boundaries > cap → falls back to whole-call (1 invocation), AppLog emitted", async () => {
    mockGetVoiceSystemSettings.mockResolvedValueOnce({
      vendorTimeoutMs: 30000,
      fallbackOnAdapterError: "throw",
      maxCostPerCallUsd: null,
      auditRetentionDays: 90,
      defaultProviderSlug: "",
      silenceTimeoutSeconds: 30,
      maxDurationSeconds: 600,
      voicemailDetectionEnabled: false,
      endCallPhrases: [],
      // tight cap to trigger the fallback
      maxSegmentsPerCall: 2,
    });
    callRow({
      phaseBoundaries: [
        { phase: "p1", startSec: 0, endSec: 10 },
        { phase: "p2_prep", startSec: 10, endSec: 20 },
        { phase: "p2_monologue", startSec: 20, endSec: 80 },
        { phase: "p3", startSec: 80, endSec: 140 },
      ],
    });
    playbookTier("ielts-speaking");
    stubFetch();
    const scorer = ieltsAdapter([6.5]);

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });

    expect(scorer).toHaveBeenCalledTimes(1);
    expect(mockExtractAudioSlice).not.toHaveBeenCalled();
    expect(result.envelope.bySegment).toBeUndefined();
    // AppLog stub was called with the segments_capped subject — fetch the
    // logged calls (we mocked the whole module).
    const { log } = await import("@/lib/logger");
    expect(log).toHaveBeenCalledWith(
      "system",
      "voice.prosody.segments_capped",
      expect.objectContaining({ callId: "c1", phaseCount: 4, cap: 2 }),
    );
  });
});

describe("runProsodyStage — 3-phase general mode (#1870)", () => {
  it("invokes adapter 3 times, aggregates general signals across phases", async () => {
    callRow({
      playbookId: "pb-general-v1",
      phaseBoundaries: [
        { phase: "intro", startSec: 0, endSec: 30 },
        { phase: "main", startSec: 30, endSec: 90 },
        { phase: "wrap", startSec: 90, endSec: 120 },
      ],
    });
    // No tierPreset → general mode
    playbookTier(null);
    stubFetch();
    // General mode derives confidenceProxy from fluency; rest are 0
    // (stub sentinel). Successive ielts.fluency values produce
    // different confidenceProxy values (mean across phases).
    let i = 0;
    const perCall = [4.5, 6.0, 7.5];
    const scorer = vi.fn(async () => ({
      ielts: { overall: 0, pronunciation: 0, fluency: perCall[i++] },
      raw: {},
    }));
    mockResolveProvider.mockResolvedValue({ slug: "speechace", isFallback: false });
    mockGetProvider.mockResolvedValue({ slug: "speechace", scoreUploadedAudio: scorer });

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });

    expect(scorer).toHaveBeenCalledTimes(3);
    expect(result.envelope.mode).toBe("general");
    expect(result.envelope.bySegment).toBeDefined();
    if (result.envelope.mode === "general") {
      // mean(min(1, 4.5/9), min(1, 6/9), min(1, 7.5/9))
      //   = mean(0.5, 0.6667, 0.8333) ≈ 0.6667
      expect(result.envelope.generalSignals?.confidenceProxy).toBeCloseTo(
        (0.5 + 6 / 9 + 7.5 / 9) / 3,
        4,
      );
      // paceWpm/hesitationRate/meanEnergyDb/pitchRangeHz are all 0 in the
      // stub. meanSkipZero of [0, 0, 0] returns 0 — documented in
      // aggregateBySegment's general branch.
      expect(result.envelope.generalSignals?.paceWpm).toBe(0);
      expect(result.envelope.generalSignals?.hesitationRate).toBe(0);
    }
  });
});
