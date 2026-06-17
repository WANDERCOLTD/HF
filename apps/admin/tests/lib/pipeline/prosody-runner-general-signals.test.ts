/**
 * Prosody runner — general-mode getGeneralSignals wiring (#1871).
 *
 * Pins:
 *   1. When the adapter implements `getGeneralSignals` AND mode resolves
 *      to "general", the runner calls it instead of `scoreUploadedAudio`.
 *   2. The returned partial is merged onto a STUB_SIGNAL_ZERO baseline →
 *      every GeneralSignals field is populated on the envelope.
 *   3. AppLog `voice.prosody.general_partial_signals` fires with the
 *      populated / missing field-name lists derived from the canonical
 *      `GENERAL_SIGNAL_FIELDS` constant.
 *   4. When the adapter does NOT implement `getGeneralSignals`, the runner
 *      falls back to the legacy `scoreUploadedAudio` + stub-zero path AND
 *      fires `voice.prosody.general_unsupported`.
 *   5. IELTS mode is unaffected — still routes through `scoreUploadedAudio`.
 *   6. Partial fill (only paceWpm) → envelope has real paceWpm + STUB
 *      zeros for the rest; AppLog lists the missing fields.
 *   7. voice.prosodyMode explicit override beats tierPresetId.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCallFindUnique = vi.fn();
const mockCallUpdate = vi.fn();
const mockPlaybookFindUnique = vi.fn();
const mockLog = vi.fn();

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
    maxSegmentsPerCall: 5,
  }),
}));

const mockResolveProvider = vi.fn();
const mockGetProvider = vi.fn();

vi.mock("@/lib/voice/resolve-speech-assessment-provider", () => ({
  resolveSpeechAssessmentProviderForCall: (...args: unknown[]) =>
    mockResolveProvider(...args),
}));

vi.mock("@/lib/speech-assessment/provider-factory", () => ({
  getSpeechAssessmentProvider: (...args: unknown[]) => mockGetProvider(...args),
}));

vi.mock("@/lib/voice/telemetry", () => ({
  logVoiceEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/pipeline/adaptive-loop-invariants", () => ({
  recordIAL4ProsodySkip: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logger", () => ({
  log: (...args: unknown[]) => mockLog(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCallUpdate.mockResolvedValue({});
});

const callRow = (overrides: { playbookId?: string | null } = {}) => {
  mockCallFindUnique.mockResolvedValue({
    id: "c1",
    stereoRecordingUrl: "https://recordings.example/abc.wav",
    playbookId: overrides.playbookId ?? "pb-general",
    voiceProsody: null,
    session: null,
  });
};

const stubFetch = () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    headers: { get: () => "audio/wav" },
  }) as unknown as typeof fetch;
};

const playbookGeneral = () => {
  mockPlaybookFindUnique.mockResolvedValue({ config: {} });
};

const playbookIelts = () => {
  mockPlaybookFindUnique.mockResolvedValue({ config: { tierPresetId: "ielts-speaking" } });
};

describe("runProsodyStage — getGeneralSignals wiring (#1871)", () => {
  it("calls adapter.getGeneralSignals when implemented + mode is general", async () => {
    callRow();
    playbookGeneral();
    stubFetch();

    const getGeneralSignals = vi.fn().mockResolvedValue({
      paceWpm: 140,
      hesitationRate: 0.08,
    });
    const scoreUploadedAudio = vi.fn();

    mockResolveProvider.mockResolvedValue({ slug: "speechace", isFallback: false });
    mockGetProvider.mockResolvedValue({
      slug: "speechace",
      scoreUploadedAudio,
      getGeneralSignals,
    });

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });

    expect(getGeneralSignals).toHaveBeenCalledTimes(1);
    expect(scoreUploadedAudio).not.toHaveBeenCalled();
    expect(result.envelope.mode).toBe("general");
    if (result.envelope.mode === "general") {
      expect(result.envelope.generalSignals?.paceWpm).toBe(140);
      expect(result.envelope.generalSignals?.hesitationRate).toBeCloseTo(0.08, 5);
      expect(result.envelope.generalSignals?.meanEnergyDb).toBe(0);
      expect(result.envelope.generalSignals?.pitchRangeHz).toBe(0);
      expect(result.envelope.generalSignals?.confidenceProxy).toBe(0);
    }
  });

  it("AppLog general_partial_signals carries populated + missing field lists", async () => {
    callRow();
    playbookGeneral();
    stubFetch();

    mockResolveProvider.mockResolvedValue({ slug: "speechace", isFallback: false });
    mockGetProvider.mockResolvedValue({
      slug: "speechace",
      scoreUploadedAudio: vi.fn(),
      getGeneralSignals: vi.fn().mockResolvedValue({
        paceWpm: 140,
        hesitationRate: 0.08,
      }),
    });

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    await runProsodyStage({ callId: "c1", callerId: "caller-a" });

    const partialCall = mockLog.mock.calls.find(
      (args) => args[1] === "voice.prosody.general_partial_signals",
    );
    expect(partialCall).toBeDefined();
    const metadata = partialCall![2] as {
      callId: string;
      adapterKey: string;
      fieldsPopulated: readonly string[];
      fieldsMissing: readonly string[];
    };
    expect(metadata.callId).toBe("c1");
    expect(metadata.adapterKey).toBe("speechace");
    expect(metadata.fieldsPopulated).toContain("paceWpm");
    expect(metadata.fieldsPopulated).toContain("hesitationRate");
    expect(metadata.fieldsMissing).toContain("meanEnergyDb");
    expect(metadata.fieldsMissing).toContain("pitchRangeHz");
  });

  it("falls back to scoreUploadedAudio when adapter has no getGeneralSignals + fires general_unsupported", async () => {
    callRow();
    playbookGeneral();
    stubFetch();

    const scoreUploadedAudio = vi
      .fn()
      .mockResolvedValue({ ielts: { overall: 6.0, pronunciation: 6.5, fluency: 6.0 }, raw: {} });

    mockResolveProvider.mockResolvedValue({ slug: "legacy-vendor", isFallback: false });
    mockGetProvider.mockResolvedValue({
      slug: "legacy-vendor",
      scoreUploadedAudio,
    });

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });

    expect(scoreUploadedAudio).toHaveBeenCalledTimes(1);
    expect(result.envelope.mode).toBe("general");
    if (result.envelope.mode === "general") {
      expect(result.envelope.generalSignals?.paceWpm).toBe(0);
      expect(result.envelope.generalSignals?.hesitationRate).toBe(0);
      expect(result.envelope.generalSignals?.confidenceProxy).toBeCloseTo(6 / 9, 2);
    }

    const unsupportedCall = mockLog.mock.calls.find(
      (args) => args[1] === "voice.prosody.general_unsupported",
    );
    expect(unsupportedCall).toBeDefined();
    expect((unsupportedCall![2] as { adapterKey: string }).adapterKey).toBe("legacy-vendor");

    const partialCall = mockLog.mock.calls.find(
      (args) => args[1] === "voice.prosody.general_partial_signals",
    );
    expect(partialCall).toBeUndefined();
  });

  it("IELTS mode is unaffected — routes through scoreUploadedAudio even when getGeneralSignals exists", async () => {
    callRow();
    playbookIelts();
    stubFetch();

    const getGeneralSignals = vi.fn();
    const scoreUploadedAudio = vi.fn().mockResolvedValue({
      ielts: { overall: 7.0, pronunciation: 7.5, fluency: 6.5, grammar: 7.0, vocabulary: 7.0 },
      raw: {},
    });

    mockResolveProvider.mockResolvedValue({ slug: "speechace", isFallback: false });
    mockGetProvider.mockResolvedValue({
      slug: "speechace",
      scoreUploadedAudio,
      getGeneralSignals,
    });

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });

    expect(getGeneralSignals).not.toHaveBeenCalled();
    expect(scoreUploadedAudio).toHaveBeenCalledTimes(1);
    expect(result.envelope.mode).toBe("ielts");
  });

  it("partial fill (only paceWpm) → envelope has real paceWpm + STUB zeros + AppLog lists 3 missing", async () => {
    callRow();
    playbookGeneral();
    stubFetch();

    mockResolveProvider.mockResolvedValue({ slug: "speechace", isFallback: false });
    mockGetProvider.mockResolvedValue({
      slug: "speechace",
      scoreUploadedAudio: vi.fn(),
      getGeneralSignals: vi.fn().mockResolvedValue({ paceWpm: 120 }),
    });

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });

    expect(result.envelope.mode).toBe("general");
    if (result.envelope.mode === "general") {
      expect(result.envelope.generalSignals?.paceWpm).toBe(120);
      expect(result.envelope.generalSignals?.hesitationRate).toBe(0);
      expect(result.envelope.generalSignals?.meanEnergyDb).toBe(0);
      expect(result.envelope.generalSignals?.pitchRangeHz).toBe(0);
    }

    const partialCall = mockLog.mock.calls.find(
      (args) => args[1] === "voice.prosody.general_partial_signals",
    );
    const meta = partialCall![2] as {
      fieldsPopulated: readonly string[];
      fieldsMissing: readonly string[];
    };
    expect(meta.fieldsPopulated).toEqual(["paceWpm"]);
    expect(meta.fieldsMissing).toEqual([
      "hesitationRate",
      "meanEnergyDb",
      "pitchRangeHz",
    ]);
  });

  it("respects voice.prosodyMode='general' explicit override (beats tierPresetId='ielts-speaking')", async () => {
    callRow();
    mockPlaybookFindUnique.mockResolvedValue({
      config: {
        tierPresetId: "ielts-speaking",
        voice: { prosodyMode: "general" },
      },
    });
    stubFetch();

    const getGeneralSignals = vi.fn().mockResolvedValue({ paceWpm: 140 });
    const scoreUploadedAudio = vi.fn();

    mockResolveProvider.mockResolvedValue({ slug: "speechace", isFallback: false });
    mockGetProvider.mockResolvedValue({
      slug: "speechace",
      scoreUploadedAudio,
      getGeneralSignals,
    });

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });

    expect(getGeneralSignals).toHaveBeenCalledTimes(1);
    expect(scoreUploadedAudio).not.toHaveBeenCalled();
    expect(result.envelope.mode).toBe("general");
  });

  it("respects voice.prosodyMode='ielts' explicit override (beats tierPresetId absent)", async () => {
    callRow();
    mockPlaybookFindUnique.mockResolvedValue({
      config: { voice: { prosodyMode: "ielts" } },
    });
    stubFetch();

    const getGeneralSignals = vi.fn();
    const scoreUploadedAudio = vi.fn().mockResolvedValue({
      ielts: { overall: 7.0, pronunciation: 7.0, fluency: 7.0 },
      raw: {},
    });

    mockResolveProvider.mockResolvedValue({ slug: "speechace", isFallback: false });
    mockGetProvider.mockResolvedValue({
      slug: "speechace",
      scoreUploadedAudio,
      getGeneralSignals,
    });

    const { runProsodyStage } = await import("@/lib/pipeline/prosody-runner");
    const result = await runProsodyStage({ callId: "c1", callerId: "caller-a" });

    expect(getGeneralSignals).not.toHaveBeenCalled();
    expect(scoreUploadedAudio).toHaveBeenCalledTimes(1);
    expect(result.envelope.mode).toBe("ielts");
  });
});
