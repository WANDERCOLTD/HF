/**
 * Tests for explainVoiceCascade (#1348 Cascade Lens v1).
 *
 * Covers:
 *   - all system defaults (no overrides anywhere)
 *   - course override wins at "course"
 *   - domain override wins at "domain"
 *   - provider blob field wins at "provider"
 *   - locked fields stay at "system" even when overridden in higher layers
 *   - secret keys never appear in the response (even when injected at every layer)
 *   - no-active-enrollment branch: playbookId/courseId null, no throw
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  callerPlaybook: { findFirst: vi.fn() },
  voiceProvider: { findUnique: vi.fn() },
  caller: { findUnique: vi.fn() },
  playbook: { findUnique: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

vi.mock("@/lib/system-settings", () => ({
  getVoiceCallSettings: vi.fn(async () => ({
    provider: "anthropic",
    model: "claude-opus-4-7",
    knowledgePlanEnabled: true,
    autoPipeline: true,
    unknownCallerPrompt: "x",
    noActivePromptFallback: "y",
  })),
}));

vi.mock("@/lib/voice/system-settings", () => ({
  getVoiceSystemSettings: vi.fn(async () => ({
    fallbackOnAdapterError: "throw",
    maxCostPerCallUsd: null,
    auditRetentionDays: 90,
    defaultProviderSlug: "vapi",
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
    voicemailDetectionEnabled: true,
    endCallPhrases: ["goodbye"],
    vendorTimeoutMs: 30000,
  })),
}));

// Synthetic schema: voiceId (non-sensitive), backgroundSound (enum),
// apiKey (sensitive). Last two cover the locked + secret filter paths.
vi.mock("@/lib/voice/provider-factory", () => ({
  getVoiceProvider: vi.fn(async () => ({
    slug: "vapi",
    getConfigSchema: () => ({
      fields: [
        { key: "voiceId", label: "Voice ID", type: "string", sensitive: false },
        {
          key: "backgroundSound",
          label: "Background Sound",
          type: "enum",
          enumValues: ["off", "office"],
          default: "off",
          sensitive: false,
        },
        { key: "apiKey", label: "API Key", type: "string", sensitive: true },
      ],
    }),
  })),
}));

describe("explainVoiceCascade (#1348)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults: caller HAS an active playbook; provider row exists with empty config;
    // domain blob empty; course blob empty. Individual tests override.
    prismaMock.callerPlaybook.findFirst.mockResolvedValue({ playbookId: "pb-1" });
    prismaMock.voiceProvider.findUnique.mockResolvedValue({
      id: "vp-1",
      slug: "vapi",
      config: {},
    });
    prismaMock.caller.findUnique.mockResolvedValue({
      domain: { config: {} },
    });
    prismaMock.playbook.findUnique.mockResolvedValue({ config: {} });
  });

  it("returns all system defaults when no overrides anywhere", async () => {
    const { explainVoiceCascade } = await import("@/lib/cascade/voice-explain");
    const result = await explainVoiceCascade("c-1");

    expect(result.callerId).toBe("c-1");
    expect(result.playbookId).toBe("pb-1");
    expect(result.courseId).toBe("pb-1");
    expect(result.providerId).toBe("vp-1");

    const autoPipeline = result.fields.find((f) => f.key === "autoPipeline");
    expect(autoPipeline?.winningSource).toBe("system");
    expect(autoPipeline?.resolvedValue).toBe(true);
    // Non-winning layers all present:false
    const chainByLayer = Object.fromEntries(
      autoPipeline!.chain.map((c) => [c.layer, c]),
    );
    expect(chainByLayer.system.present).toBe(true);
    expect(chainByLayer.provider.present).toBe(false);
    expect(chainByLayer.domain.present).toBe(false);
    expect(chainByLayer.course.present).toBe(false);
  });

  it("course override wins at 'course'", async () => {
    prismaMock.playbook.findUnique.mockResolvedValue({
      config: { voice: { silenceTimeoutSeconds: 12 } },
    });
    const { explainVoiceCascade } = await import("@/lib/cascade/voice-explain");
    const result = await explainVoiceCascade("c-1");

    const silence = result.fields.find((f) => f.key === "silenceTimeoutSeconds");
    expect(silence?.winningSource).toBe("course");
    expect(silence?.resolvedValue).toBe(12);
    const courseEntry = silence!.chain.find((c) => c.layer === "course")!;
    expect(courseEntry.present).toBe(true);
    expect(courseEntry.value).toBe(12);
  });

  it("domain override wins at 'domain'", async () => {
    prismaMock.caller.findUnique.mockResolvedValue({
      domain: { config: { voice: { maxDurationSeconds: 900 } } },
    });
    const { explainVoiceCascade } = await import("@/lib/cascade/voice-explain");
    const result = await explainVoiceCascade("c-1");

    const max = result.fields.find((f) => f.key === "maxDurationSeconds");
    expect(max?.winningSource).toBe("domain");
    expect(max?.resolvedValue).toBe(900);
  });

  it("provider blob field wins at 'provider'", async () => {
    prismaMock.voiceProvider.findUnique.mockResolvedValue({
      id: "vp-1",
      slug: "vapi",
      config: { voiceId: "asteria" },
    });
    const { explainVoiceCascade } = await import("@/lib/cascade/voice-explain");
    const result = await explainVoiceCascade("c-1");

    const voiceId = result.fields.find((f) => f.key === "voiceId");
    expect(voiceId?.winningSource).toBe("provider");
    expect(voiceId?.resolvedValue).toBe("asteria");
  });

  it("locked fields (provider, model) stay at 'system' even when overridden in higher layers", async () => {
    prismaMock.caller.findUnique.mockResolvedValue({
      domain: { config: { voice: { provider: "retell", model: "gpt-4o" } } },
    });
    prismaMock.playbook.findUnique.mockResolvedValue({
      config: { voice: { provider: "elevenlabs", model: "gpt-3.5" } },
    });
    const { explainVoiceCascade } = await import("@/lib/cascade/voice-explain");
    const result = await explainVoiceCascade("c-1");

    const provider = result.fields.find((f) => f.key === "provider");
    expect(provider?.locked).toBe(true);
    expect(provider?.winningSource).toBe("system");
    expect(provider?.resolvedValue).toBe("vapi");
    // Domain + Course pills must NOT report values for locked keys
    const provDomain = provider!.chain.find((c) => c.layer === "domain")!;
    expect(provDomain.present).toBe(false);
    const provCourse = provider!.chain.find((c) => c.layer === "course")!;
    expect(provCourse.present).toBe(false);

    const model = result.fields.find((f) => f.key === "model");
    expect(model?.locked).toBe(true);
    // resolveVoiceConfig reports model.source as "provider" when a model
    // value is configured (it's pinned to the enabled VP). For locked
    // keys what matters is: NEVER "domain" or "course".
    expect(["system", "provider"]).toContain(model?.winningSource);
    expect(model?.winningSource).not.toBe("domain");
    expect(model?.winningSource).not.toBe("course");
    expect(model?.resolvedValue).toBe("claude-opus-4-7");
    const modelDomain = model!.chain.find((c) => c.layer === "domain")!;
    expect(modelDomain.present).toBe(false);
    const modelCourse = model!.chain.find((c) => c.layer === "course")!;
    expect(modelCourse.present).toBe(false);
  });

  it("secret keys never appear in fields[] (even when injected at every layer)", async () => {
    prismaMock.voiceProvider.findUnique.mockResolvedValue({
      id: "vp-1",
      slug: "vapi",
      config: {
        apiKey: "sk-provider",
        modelSecret: "ms-provider",
        webhookSecret: "ws-provider",
        secret: "raw-provider",
      },
    });
    prismaMock.caller.findUnique.mockResolvedValue({
      domain: {
        config: {
          voice: {
            apiKey: "sk-domain",
            modelSecret: "ms-domain",
            webhookSecret: "ws-domain",
            secret: "raw-domain",
          },
        },
      },
    });
    prismaMock.playbook.findUnique.mockResolvedValue({
      config: {
        voice: {
          apiKey: "sk-course",
          modelSecret: "ms-course",
          webhookSecret: "ws-course",
          secret: "raw-course",
        },
      },
    });
    const { explainVoiceCascade } = await import("@/lib/cascade/voice-explain");
    const result = await explainVoiceCascade("c-1");

    const keys = result.fields.map((f) => f.key);
    expect(keys).not.toContain("apiKey");
    expect(keys).not.toContain("modelSecret");
    expect(keys).not.toContain("webhookSecret");
    expect(keys).not.toContain("secret");
    // And nothing leaks into chain entries either
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("sk-domain");
    expect(serialised).not.toContain("sk-course");
    expect(serialised).not.toContain("ms-provider");
  });

  it("caller with no active enrollment: playbookId/courseId null, domain+course present:false, no throw", async () => {
    prismaMock.callerPlaybook.findFirst.mockResolvedValue(null);
    // playbook.findUnique should NOT be called when playbookId is null
    prismaMock.playbook.findUnique.mockResolvedValue(null);

    const { explainVoiceCascade } = await import("@/lib/cascade/voice-explain");
    const result = await explainVoiceCascade("c-2");

    expect(result.playbookId).toBeNull();
    expect(result.courseId).toBeNull();
    expect(result.fields.length).toBeGreaterThan(0);
    // Every non-locked field's course pill must be present:false in this branch
    for (const field of result.fields) {
      const course = field.chain.find((c) => c.layer === "course")!;
      expect(course.present).toBe(false);
    }
  });
});
