/**
 * PROSODY stage runner tests (#1119).
 *
 * 5 acceptance-criteria vitests:
 *   1. IELTS happy path — vendor returns fixture scores → envelope shape correct
 *   2. No-recording — stereoRecordingUrl null → mode=unavailable, no vendor call
 *   3. Vendor 5xx — adapter throws → mode=unavailable, errorReason=vendor_error
 *   4. Vendor timeout — adapter hangs → after vendorTimeoutMs → vendor_timeout
 *   5. Idempotency — second run on same Call.id without force → vendor NOT called
 *
 * All vendor calls are mocked via the speech-assessment factory.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the speech-assessment factory BEFORE importing the runner so the
// runner picks up the mock when it resolves the provider.
vi.mock("@/lib/speech-assessment/provider-factory", () => ({
  getSpeechAssessmentProvider: vi.fn(),
  getDefaultSpeechAssessmentProviderSlug: vi.fn(),
}));

vi.mock("@/lib/voice/resolve-speech-assessment-provider", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/voice/resolve-speech-assessment-provider")
  >("@/lib/voice/resolve-speech-assessment-provider");
  return {
    ...actual,
    resolveSpeechAssessmentProviderForCall: vi.fn(),
  };
});

vi.mock("@/lib/voice/system-settings", () => ({
  getVoiceSystemSettings: vi.fn().mockResolvedValue({
    fallbackOnAdapterError: "throw",
    maxCostPerCallUsd: null,
    auditRetentionDays: 90,
    defaultProviderSlug: "",
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
    voicemailDetectionEnabled: false,
    endCallPhrases: [],
    vendorTimeoutMs: 50, // Tight budget for the timeout test
  }),
}));

vi.mock("@/lib/voice/telemetry", () => ({
  logVoiceEvent: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const callStore = new Map<string, Record<string, unknown>>();
  const playbookStore = new Map<string, Record<string, unknown>>();
  return {
    prisma: {
      call: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const row = callStore.get(where.id);
          return row ?? null;
        }),
        update: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => {
            const existing = callStore.get(where.id) ?? {};
            const updated = { ...existing, ...data };
            callStore.set(where.id, updated);
            return updated;
          },
        ),
      },
      playbook: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          return playbookStore.get(where.id) ?? null;
        }),
      },
      __callStore: callStore,
      __playbookStore: playbookStore,
    },
  };
});

import { runProsodyStage } from "@/lib/pipeline/prosody-runner";
import { prisma } from "@/lib/prisma";
import { resolveSpeechAssessmentProviderForCall } from "@/lib/voice/resolve-speech-assessment-provider";
import type { SpeechAssessmentAdapter } from "@/lib/speech-assessment/types";

type PrismaTest = typeof prisma & {
  __callStore: Map<string, Record<string, unknown>>;
  __playbookStore: Map<string, Record<string, unknown>>;
};

function seedCall(
  id: string,
  data: Partial<{
    stereoRecordingUrl: string | null;
    playbookId: string | null;
    voiceProsody: unknown;
  }>,
): void {
  (prisma as PrismaTest).__callStore.set(id, {
    id,
    stereoRecordingUrl: data.stereoRecordingUrl ?? null,
    playbookId: data.playbookId ?? null,
    voiceProsody: data.voiceProsody ?? null,
  });
}

function seedPlaybook(id: string, config: Record<string, unknown>): void {
  (prisma as PrismaTest).__playbookStore.set(id, { id, config });
}

function makeAdapter(
  scoreFn: SpeechAssessmentAdapter["scoreUploadedAudio"],
): SpeechAssessmentAdapter {
  return {
    slug: "mock-vendor",
    getCapabilities: () => ({
      ieltsSupported: true,
      spontaneousSupported: true,
      scriptedSupported: false,
      acceptsRecordingUrl: false,
      requiresFileUpload: true,
      transcriptIncluded: true,
      perWordDiagnostics: false,
      prosodyFeatures: false,
    }),
    getConfigSchema: () => ({ fields: [] }),
    scoreUploadedAudio: scoreFn,
  };
}

describe("runProsodyStage", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (prisma as PrismaTest).__callStore.clear();
    (prisma as PrismaTest).__playbookStore.clear();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    // Default fetch mock — successful audio download.
    fetchSpy.mockResolvedValue(
      new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("IELTS happy path — vendor scores normalise into ieltsScores envelope", async () => {
    seedCall("c1", {
      stereoRecordingUrl: "https://vapi.test/recording.wav",
      playbookId: "p1",
    });
    seedPlaybook("p1", { tierPresetId: "ielts-speaking" });

    const scoreFn = vi.fn().mockResolvedValue({
      ielts: {
        overall: 7.5,
        pronunciation: 8.0,
        fluency: 7.0,
        grammar: 7.5,
        vocabulary: 7.0,
        coherence: 8.0,
      },
      transcript: "Today I would like to talk about...",
      raw: { fixture: true },
    });
    const adapter = makeAdapter(scoreFn);

    (
      resolveSpeechAssessmentProviderForCall as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ slug: "speechace", source: "system" });
    const { getSpeechAssessmentProvider } = await import(
      "@/lib/speech-assessment/provider-factory"
    );
    (getSpeechAssessmentProvider as ReturnType<typeof vi.fn>).mockResolvedValue(
      adapter,
    );

    const result = await runProsodyStage({ callId: "c1", callerId: null });

    expect(result.envelope.mode).toBe("ielts");
    expect(result.envelope.ieltsScores).toEqual({
      overall: 7.5,
      pronunciation: 8.0,
      fluencyCoherence: 7.0,
      lexicalResource: 7.0,
      grammaticalRange: 7.5,
    });
    expect(scoreFn).toHaveBeenCalledOnce();
    expect(result.vendorCalled).toBe(true);

    const persisted = (prisma as PrismaTest).__callStore.get("c1");
    expect(persisted?.voiceProsody).toBeDefined();
  });

  it("Sim-safe — stereoRecordingUrl null → mode=unavailable, errorReason=no_recording, no vendor call", async () => {
    seedCall("c2", { stereoRecordingUrl: null });

    const scoreFn = vi.fn();
    const adapter = makeAdapter(scoreFn);
    (
      resolveSpeechAssessmentProviderForCall as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ slug: "speechace", source: "system" });
    const { getSpeechAssessmentProvider } = await import(
      "@/lib/speech-assessment/provider-factory"
    );
    (getSpeechAssessmentProvider as ReturnType<typeof vi.fn>).mockResolvedValue(
      adapter,
    );

    const result = await runProsodyStage({ callId: "c2", callerId: null });

    expect(result.envelope.mode).toBe("unavailable");
    expect(result.envelope.errorReason).toBe("no_recording");
    expect(scoreFn).not.toHaveBeenCalled();
    expect(result.vendorCalled).toBe(false);

    const persisted = (prisma as PrismaTest).__callStore.get("c2");
    const env = persisted?.voiceProsody as { mode: string; errorReason: string };
    expect(env?.mode).toBe("unavailable");
    expect(env?.errorReason).toBe("no_recording");
  });

  it("Vendor 5xx — adapter throws → mode=unavailable, errorReason=vendor_error", async () => {
    seedCall("c3", { stereoRecordingUrl: "https://vapi.test/rec.wav" });

    const scoreFn = vi.fn().mockRejectedValue(new Error("HTTP 500 internal"));
    const adapter = makeAdapter(scoreFn);
    (
      resolveSpeechAssessmentProviderForCall as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ slug: "speechace", source: "system" });
    const { getSpeechAssessmentProvider } = await import(
      "@/lib/speech-assessment/provider-factory"
    );
    (getSpeechAssessmentProvider as ReturnType<typeof vi.fn>).mockResolvedValue(
      adapter,
    );

    const result = await runProsodyStage({ callId: "c3", callerId: null });

    expect(result.envelope.mode).toBe("unavailable");
    expect(result.envelope.errorReason).toBe("vendor_error");
    expect(scoreFn).toHaveBeenCalledOnce();
  });

  it("Vendor timeout — adapter never resolves → mode=unavailable, errorReason=vendor_timeout", async () => {
    seedCall("c4", { stereoRecordingUrl: "https://vapi.test/rec.wav" });

    const scoreFn = vi.fn().mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    const adapter = makeAdapter(scoreFn);
    (
      resolveSpeechAssessmentProviderForCall as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ slug: "speechace", source: "system" });
    const { getSpeechAssessmentProvider } = await import(
      "@/lib/speech-assessment/provider-factory"
    );
    (getSpeechAssessmentProvider as ReturnType<typeof vi.fn>).mockResolvedValue(
      adapter,
    );

    const startMs = Date.now();
    const result = await runProsodyStage({ callId: "c4", callerId: null });
    const elapsedMs = Date.now() - startMs;

    expect(result.envelope.mode).toBe("unavailable");
    expect(result.envelope.errorReason).toBe("vendor_timeout");
    expect(scoreFn).toHaveBeenCalledOnce();
    // Vendor timeout setting is 50ms (from mock above); allow generous
    // upper bound to avoid flakes on slow CI.
    expect(elapsedMs).toBeGreaterThanOrEqual(50);
    expect(elapsedMs).toBeLessThan(5000);
  });

  it("Idempotency — second run without force returns existing envelope, no vendor call", async () => {
    const existingEnvelope = {
      mode: "ielts",
      ieltsScores: {
        overall: 6.5,
        pronunciation: 7.0,
        fluencyCoherence: 6.0,
        lexicalResource: 6.5,
        grammaticalRange: 6.5,
      },
    };
    seedCall("c5", {
      stereoRecordingUrl: "https://vapi.test/rec.wav",
      voiceProsody: existingEnvelope,
    });

    const scoreFn = vi.fn();
    const adapter = makeAdapter(scoreFn);
    (
      resolveSpeechAssessmentProviderForCall as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ slug: "speechace", source: "system" });
    const { getSpeechAssessmentProvider } = await import(
      "@/lib/speech-assessment/provider-factory"
    );
    (getSpeechAssessmentProvider as ReturnType<typeof vi.fn>).mockResolvedValue(
      adapter,
    );

    const result = await runProsodyStage({ callId: "c5", callerId: null });

    expect(result.skippedReason).toBe("existing_envelope");
    expect(result.envelope.mode).toBe("ielts");
    expect(scoreFn).not.toHaveBeenCalled();
    expect(result.vendorCalled).toBe(false);
  });

  it("Idempotency — force=true bypasses the existing-envelope short-circuit", async () => {
    seedCall("c6", {
      stereoRecordingUrl: "https://vapi.test/rec.wav",
      voiceProsody: { mode: "ielts", ieltsScores: { overall: 5 } },
    });

    const scoreFn = vi.fn().mockResolvedValue({
      ielts: {
        overall: 8.0,
        pronunciation: 8.5,
        fluency: 7.5,
        grammar: 8.0,
        vocabulary: 8.0,
      },
      raw: {},
    });
    const adapter = makeAdapter(scoreFn);
    (
      resolveSpeechAssessmentProviderForCall as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ slug: "speechace", source: "system" });
    const { getSpeechAssessmentProvider } = await import(
      "@/lib/speech-assessment/provider-factory"
    );
    (getSpeechAssessmentProvider as ReturnType<typeof vi.fn>).mockResolvedValue(
      adapter,
    );
    seedPlaybook("p6", { tierPresetId: "ielts-speaking" });
    (prisma as PrismaTest).__callStore.get("c6")!.playbookId = "p6";

    const result = await runProsodyStage({
      callId: "c6",
      callerId: null,
      force: true,
    });

    expect(result.skippedReason).toBeUndefined();
    expect(scoreFn).toHaveBeenCalledOnce();
    expect(result.envelope.ieltsScores?.overall).toBe(8.0);
  });
});
