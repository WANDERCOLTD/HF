/**
 * G3 / #1144 — runProsodyStage mode detection + envelope contract
 *
 * Defends:
 *   - IELTS-mode trigger (tierPresetId === "ielts-speaking")
 *   - No-recording short-circuit (mode "unavailable" + errorReason "no_recording")
 *   - Idempotency (existing envelope → vendor NOT called, unless force=true)
 *   - Failure-as-envelope contract (never throws — pipeline must continue)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCallFindUnique = vi.fn();
const mockCallUpdate = vi.fn();
const mockPlaybookFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    call: { findUnique: mockCallFindUnique, update: mockCallUpdate },
    playbook: { findUnique: mockPlaybookFindUnique },
  },
}));

vi.mock("@/lib/voice/system-settings", () => ({
  getVoiceSystemSettings: vi.fn().mockResolvedValue({
    vendorTimeoutMs: 30000,
    fallbackOnAdapterError: "throw",
    maxCostPerCallUsd: null,
    auditRetentionDays: 90,
    defaultProviderSlug: "",
    silenceTimeoutSeconds: 90,
    maxDurationSeconds: 600,
    voicemailDetectionEnabled: false,
    endCallPhrases: [],
  }),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockCallUpdate.mockResolvedValue({});
});

const playbookTier = (tierPresetId: string | null) => {
  mockPlaybookFindUnique.mockResolvedValue({
    config: tierPresetId ? { tierPresetId } : {},
  });
};

const callRow = (overrides: {
  stereoRecordingUrl?: string | null;
  playbookId?: string | null;
  voiceProsody?: unknown;
}) => {
  mockCallFindUnique.mockResolvedValue({
    id: "c1",
    stereoRecordingUrl:
      overrides.stereoRecordingUrl === undefined
        ? "https://recordings.example/abc.wav"
        : overrides.stereoRecordingUrl,
    playbookId: overrides.playbookId ?? "pb-ielts-v1",
    voiceProsody: overrides.voiceProsody ?? null,
  });
};

const happyAdapter = (result: unknown) => {
  mockResolveProvider.mockResolvedValue({ slug: "speechace", isFallback: false });
  // getSpeechAssessmentProvider returns the SpeechAssessmentAdapter directly —
  // the adapter has .slug + scoreUploadedAudio on itself, no wrapper.
  mockGetProvider.mockResolvedValue({
    slug: "speechace",
    scoreUploadedAudio: vi.fn().mockResolvedValue(result),
  });
};

const stubFetch = () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    headers: { get: () => "audio/wav" },
  }) as unknown as typeof fetch;
};

describe("runProsodyStage — mode detection (G3 / #1144)", () => {
  it("ielts mode when tierPresetId='ielts-speaking' + stereo URL set", async () => {
    callRow({});
    playbookTier("ielts-speaking");
    stubFetch();
    happyAdapter({
      ielts: { overall: 6.5, pronunciation: 7.0, fluency: 6.5, vocabulary: 6.0, grammar: 6.5 },
    });
    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });
    expect(result.envelope.mode).toBe("ielts");
    expect(result.vendorCalled).toBe(true);
    if (result.envelope.mode === "ielts") {
      expect(result.envelope.ieltsScores).toMatchObject({ overall: 6.5, pronunciation: 7.0 });
    }
  });

  it("general mode when tierPresetId is null", async () => {
    callRow({});
    playbookTier(null);
    stubFetch();
    happyAdapter({ ielts: { overall: 6.0, pronunciation: 6.0, fluency: 6.0 } });
    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });
    expect(result.envelope.mode).toBe("general");
  });

  it("general mode when playbookId is null (no Playbook to read tier from)", async () => {
    callRow({ playbookId: null });
    stubFetch();
    happyAdapter({ ielts: { overall: 5, pronunciation: 5, fluency: 5 } });
    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });
    expect(result.envelope.mode).toBe("general");
    // detectProsodyMode short-circuits at `if (!playbookId) return "general"`
    // so the Playbook lookup is bypassed from this caller. (Other call sites
    // in resolve-speech-assessment-provider may consult the Playbook —
    // intentionally not asserted here.)
  });
});

describe("runProsodyStage — no-recording short-circuit (G3 / #1144)", () => {
  it("unavailable + no_recording when stereoRecordingUrl is null", async () => {
    callRow({ stereoRecordingUrl: null });
    playbookTier("ielts-speaking");
    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });
    expect(result.envelope.mode).toBe("unavailable");
    if (result.envelope.mode === "unavailable") {
      expect(result.envelope.errorReason).toBe("no_recording");
    }
    expect(result.vendorCalled).toBe(false);
    expect(mockResolveProvider).not.toHaveBeenCalled();
    expect(mockPlaybookFindUnique).not.toHaveBeenCalled();
  });

  it("persists the unavailable envelope to Call.voiceProsody for forensics", async () => {
    callRow({ stereoRecordingUrl: null });
    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    await runProsodyStage({ callId: "c1", callerId: "caller-a" });
    expect(mockCallUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1" },
        data: expect.objectContaining({
          voiceProsody: expect.objectContaining({
            mode: "unavailable",
            errorReason: "no_recording",
          }),
        }),
      }),
    );
  });
});

describe("runProsodyStage — idempotency (G3 / #1144)", () => {
  it("bails without vendor call when voiceProsody already populated", async () => {
    callRow({
      voiceProsody: { mode: "ielts", ieltsScores: { overall: 6.0, pronunciation: 6.0, fluency: 6.5 } },
    });
    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });
    expect(result.vendorCalled).toBe(false);
    expect(result.skippedReason).toBe("existing_envelope");
    expect(result.envelope.mode).toBe("ielts");
    expect(mockResolveProvider).not.toHaveBeenCalled();
  });

  it("re-runs vendor when force=true even with existing envelope", async () => {
    callRow({
      voiceProsody: { mode: "ielts", ieltsScores: { overall: 5.5, pronunciation: 5.5, fluency: 5.5 } },
    });
    playbookTier("ielts-speaking");
    stubFetch();
    happyAdapter({ ielts: { overall: 7.0, pronunciation: 7.0, fluency: 7.0 } });
    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a", force: true });
    expect(result.vendorCalled).toBe(true);
    expect(result.skippedReason).toBeUndefined();
    if (result.envelope.mode === "ielts") {
      expect(result.envelope.ieltsScores?.overall).toBe(7.0);
    }
  });
});

describe("runProsodyStage — failure-as-envelope contract (G3 / #1144)", () => {
  it("never throws when provider resolution fails — encodes failure in the envelope", async () => {
    callRow({});
    playbookTier("ielts-speaking");
    stubFetch();
    mockResolveProvider.mockRejectedValue(
      new Error("No SpeechAssessmentProvider with isDefault=true AND enabled=true"),
    );
    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });
    expect(result.envelope.mode).toBe("unavailable");
    expect(result.vendorCalled).toBe(false);
  });
});
