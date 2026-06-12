/**
 * Slice 2 of epic #1510 (#1512) — I-AL4 wiring at runProsodyStage.
 *
 * Defends the structural contract from `docs/CHAIN-CONTRACTS.md` §6 (I-AL4):
 *
 *   - Non-cache-hit skip paths emit I-AL4 with reason ∈
 *     {"no-stereoUrl", "no-tierPreset", "no-provider"} (WARN severity).
 *   - The "existing-envelope" cache-hit path stays SILENT — that is a
 *     normal cache hit, not a violation.
 *   - All-conditions-met path runs the vendor adapter (no I-AL4 emit).
 *
 * Mirrors `prosody-runner.test.ts` mock topology, with an additional spy
 * on `recordIAL4ProsodySkip` from the invariant runner module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

const mockRecordIAL4 = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/pipeline/adaptive-loop-invariants", () => ({
  recordIAL4ProsodySkip: (...args: unknown[]) => mockRecordIAL4(...args),
}));

// ── Helpers ───────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockCallUpdate.mockResolvedValue({});
});

const callRow = (overrides: {
  stereoRecordingUrl?: string | null;
  playbookId?: string | null;
  voiceProsody?: unknown;
}) => {
  mockCallFindUnique.mockResolvedValue({
    id: "c-i-al4",
    stereoRecordingUrl:
      overrides.stereoRecordingUrl === undefined
        ? "https://recordings.example/abc.wav"
        : overrides.stereoRecordingUrl,
    playbookId: overrides.playbookId === undefined ? "pb-1" : overrides.playbookId,
    voiceProsody: overrides.voiceProsody ?? null,
  });
};

const playbookConfig = (config: Record<string, unknown> | null) => {
  mockPlaybookFindUnique.mockResolvedValue({ config });
};

const happyAdapter = (result: unknown) => {
  mockResolveProvider.mockResolvedValue({ slug: "speechace", isFallback: false });
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

// ── Tests ─────────────────────────────────────────────────

describe("runProsodyStage — I-AL4 wiring (Slice 2 / #1512)", () => {
  it('null stereoRecordingUrl emits I-AL4 with reason="no-stereoUrl"', async () => {
    callRow({ stereoRecordingUrl: null });
    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    await runProsodyStage({ callId: "c-i-al4", callerId: "caller-x" });

    expect(mockRecordIAL4).toHaveBeenCalledTimes(1);
    expect(mockRecordIAL4).toHaveBeenCalledWith({
      callId: "c-i-al4",
      callerId: "caller-x",
      reason: "no-stereoUrl",
    });
    // Confirms we still don't make a vendor call.
    expect(mockResolveProvider).not.toHaveBeenCalled();
  });

  it('stereoUrl present but tierPresetId unset emits I-AL4 with reason="no-tierPreset"', async () => {
    callRow({ playbookId: "pb-general" });
    // No tierPresetId, no voice.prosodyMode → triggers no-tierPreset.
    playbookConfig({});
    // Provider resolves OK so we exercise just the mode-detection branch.
    mockResolveProvider.mockResolvedValue({ slug: "speechace", isFallback: false });
    mockGetProvider.mockResolvedValue({
      slug: "speechace",
      scoreUploadedAudio: vi.fn().mockResolvedValue({
        ielts: { overall: 6, pronunciation: 6, fluency: 6 },
      }),
    });
    stubFetch();

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    await runProsodyStage({ callId: "c-i-al4", callerId: "caller-x" });

    const noTierCalls = mockRecordIAL4.mock.calls.filter(
      (c) => (c[0] as { reason: string }).reason === "no-tierPreset",
    );
    expect(noTierCalls).toHaveLength(1);
    expect(noTierCalls[0][0]).toMatchObject({
      callId: "c-i-al4",
      callerId: "caller-x",
      reason: "no-tierPreset",
    });
  });

  it('explicit voice.prosodyMode = "general" suppresses no-tierPreset emit', async () => {
    callRow({ playbookId: "pb-explicit" });
    // Operator explicitly chose general — no nag.
    playbookConfig({ voice: { prosodyMode: "general" } });
    mockResolveProvider.mockResolvedValue({ slug: "speechace", isFallback: false });
    mockGetProvider.mockResolvedValue({
      slug: "speechace",
      scoreUploadedAudio: vi.fn().mockResolvedValue({
        ielts: { overall: 6, pronunciation: 6, fluency: 6 },
      }),
    });
    stubFetch();

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    await runProsodyStage({ callId: "c-i-al4", callerId: "caller-x" });

    const noTierCalls = mockRecordIAL4.mock.calls.filter(
      (c) => (c[0] as { reason: string }).reason === "no-tierPreset",
    );
    expect(noTierCalls).toHaveLength(0);
  });

  it('provider resolution failure emits I-AL4 with reason="no-provider"', async () => {
    callRow({ playbookId: "pb-1" });
    playbookConfig({ tierPresetId: "ielts-speaking" });
    stubFetch();
    mockResolveProvider.mockRejectedValue(
      new Error("No SpeechAssessmentProvider with isDefault=true AND enabled=true"),
    );

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    await runProsodyStage({ callId: "c-i-al4", callerId: "caller-x" });

    const noProviderCalls = mockRecordIAL4.mock.calls.filter(
      (c) => (c[0] as { reason: string }).reason === "no-provider",
    );
    expect(noProviderCalls).toHaveLength(1);
    expect(noProviderCalls[0][0]).toMatchObject({
      callId: "c-i-al4",
      callerId: "caller-x",
      reason: "no-provider",
    });
  });

  it("existing envelope (cache hit) does NOT emit I-AL4 — silent skip is normal", async () => {
    callRow({
      voiceProsody: {
        mode: "ielts",
        ieltsScores: { overall: 6.5, pronunciation: 6.5, fluency: 6.5 },
      },
    });

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c-i-al4", callerId: "caller-x" });

    expect(result.skippedReason).toBe("existing_envelope");
    expect(mockRecordIAL4).not.toHaveBeenCalled();
  });

  it("all conditions met — runs vendor adapter, no I-AL4 emit", async () => {
    callRow({ playbookId: "pb-ielts" });
    playbookConfig({ tierPresetId: "ielts-speaking" });
    stubFetch();
    const adapterSpy = vi.fn().mockResolvedValue({
      ielts: { overall: 7.0, pronunciation: 7.0, fluency: 7.0 },
    });
    mockResolveProvider.mockResolvedValue({ slug: "speechace", isFallback: false });
    mockGetProvider.mockResolvedValue({
      slug: "speechace",
      scoreUploadedAudio: adapterSpy,
    });

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c-i-al4", callerId: "caller-x" });

    expect(adapterSpy).toHaveBeenCalledTimes(1);
    expect(result.envelope.mode).toBe("ielts");
    expect(mockRecordIAL4).not.toHaveBeenCalled();
  });

  it("playbookId=null does NOT emit no-tierPreset (no Playbook to read tier from)", async () => {
    callRow({ playbookId: null });
    stubFetch();
    happyAdapter({ ielts: { overall: 5, pronunciation: 5, fluency: 5 } });

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    await runProsodyStage({ callId: "c-i-al4", callerId: "caller-x" });

    const noTierCalls = mockRecordIAL4.mock.calls.filter(
      (c) => (c[0] as { reason: string }).reason === "no-tierPreset",
    );
    expect(noTierCalls).toHaveLength(0);
  });
});
