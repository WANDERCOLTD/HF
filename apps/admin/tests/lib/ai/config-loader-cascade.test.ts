/**
 * Pins the cascade order in `getAIConfig(callPoint, scope?)` (#1868).
 *
 * Layers (highest priority first):
 *   1. Playbook.config.aiOverrides[callPoint]
 *   2. Domain.config.aiOverrides[callPoint]
 *   3. AIConfig table
 *   4. SystemSettings `fallback:ai.default_models`
 *   5. CALL_POINTS hardcoded defaults
 *   6. Ultimate fallback (any available provider)
 *
 * Mirrors the convergence rule in `.claude/rules/ai-callpoint-cascade.md`.
 * Sibling round-trip pin to `tests/lib/journey/registry-schema-coverage.test.ts`
 * (Coverage pillar) — when a future PR widens AIConfigScope, this bank
 * fails until the cascade order is re-verified.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => {
  const playbookFindUnique = vi.fn();
  const domainFindUnique = vi.fn();
  const callFindUnique = vi.fn();
  const aiConfigFindUnique = vi.fn();
  return {
    prisma: {
      playbook: { findUnique: playbookFindUnique },
      domain: { findUnique: domainFindUnique },
      call: { findUnique: callFindUnique },
      aIConfig: { findUnique: aiConfigFindUnique },
    },
  };
});

vi.mock("@/lib/fallback-settings", () => ({
  getAIModelConfigsFallback: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  config: {
    ai: {
      claude: { model: "claude-sonnet-4-6", apiKey: "test" },
      openai: { model: "gpt-4o", apiKey: "test" },
    },
  },
}));

// API key envs so `isEngineAvailable("claude")` is true at module-load time.
process.env.ANTHROPIC_API_KEY = "test";
process.env.OPENAI_API_KEY = "test";

import { prisma } from "@/lib/prisma";
import { getAIModelConfigsFallback } from "@/lib/fallback-settings";
import { getAIConfig, clearAIConfigCache } from "@/lib/ai/config-loader";

const playbookFindUnique = vi.mocked(prisma.playbook.findUnique);
const domainFindUnique = vi.mocked(prisma.domain.findUnique);
const callFindUnique = vi.mocked(prisma.call.findUnique);
const aiConfigFindUnique = vi.mocked(prisma.aIConfig.findUnique);
const fallbackMock = vi.mocked(getAIModelConfigsFallback);

beforeEach(() => {
  clearAIConfigCache();
  playbookFindUnique.mockReset();
  domainFindUnique.mockReset();
  callFindUnique.mockReset();
  aiConfigFindUnique.mockReset();
  fallbackMock.mockReset();
  // Sensible default — none of the layers exist unless a test opts in.
  playbookFindUnique.mockResolvedValue(null);
  domainFindUnique.mockResolvedValue(null);
  callFindUnique.mockResolvedValue(null);
  aiConfigFindUnique.mockResolvedValue(null);
  fallbackMock.mockResolvedValue({});
});

describe("getAIConfig — cascade order (#1868)", () => {
  it("returns ultimate fallback when no layer supplies anything", async () => {
    const r = await getAIConfig("pipeline.measure");
    // CALL_POINTS hardcoded default still wins (call-points.ts seeds them).
    // The result must be a concrete model id, not null.
    expect(typeof r.model).toBe("string");
    expect(r.model.length).toBeGreaterThan(0);
  });

  it("layer 5 — hardcoded CALL_POINTS defaults are returned when nothing else is set", async () => {
    const r = await getAIConfig("pipeline.measure");
    expect(r.modelLayer).toBe("hardcoded");
  });

  it("layer 4 — SystemSettings fallback wins over hardcoded", async () => {
    fallbackMock.mockResolvedValue({
      "pipeline.measure": { provider: "claude", model: "system-sonnet-4-6" } as any,
    });
    const r = await getAIConfig("pipeline.measure");
    expect(r.model).toBe("system-sonnet-4-6");
    expect(r.modelLayer).toBe("system");
  });

  it("layer 3 — AIConfig table wins over SystemSettings fallback", async () => {
    fallbackMock.mockResolvedValue({
      "pipeline.measure": { provider: "claude", model: "system-sonnet-4-6" } as any,
    });
    aiConfigFindUnique.mockResolvedValue({
      callPoint: "pipeline.measure",
      provider: "claude",
      model: "global-sonnet-4-6",
      maxTokens: null,
      temperature: null,
      timeoutMs: null,
      isActive: true,
    } as any);
    const r = await getAIConfig("pipeline.measure");
    expect(r.model).toBe("global-sonnet-4-6");
    expect(r.modelLayer).toBe("global");
  });

  it("layer 2 — Domain override wins over AIConfig table when scope supplied", async () => {
    aiConfigFindUnique.mockResolvedValue({
      callPoint: "pipeline.measure",
      provider: "claude",
      model: "global-sonnet-4-6",
      maxTokens: null,
      temperature: null,
      timeoutMs: null,
      isActive: true,
    } as any);
    domainFindUnique.mockResolvedValue({
      config: { aiOverrides: { "pipeline.measure": { provider: "claude", model: "domain-opus-4-7" } } },
    } as any);
    const r = await getAIConfig("pipeline.measure", { domainId: "dom-1" });
    expect(r.model).toBe("domain-opus-4-7");
    expect(r.modelLayer).toBe("domain");
    expect(r.isCustomized).toBe(true);
  });

  it("layer 1 — Playbook override wins over Domain override", async () => {
    playbookFindUnique.mockResolvedValue({
      config: { aiOverrides: { "pipeline.measure": { provider: "claude", model: "playbook-opus-4-7" } } },
      domainId: "dom-1",
    } as any);
    domainFindUnique.mockResolvedValue({
      config: { aiOverrides: { "pipeline.measure": { provider: "claude", model: "domain-opus-4-7" } } },
    } as any);
    const r = await getAIConfig("pipeline.measure", { playbookId: "pb-1" });
    expect(r.model).toBe("playbook-opus-4-7");
    expect(r.modelLayer).toBe("playbook");
  });

  it("scope expansion — Call → Playbook → Domain lookup chain runs when only callId given", async () => {
    callFindUnique.mockResolvedValue({
      playbookId: "pb-from-call",
      caller: { domainId: "dom-from-call" },
    } as any);
    playbookFindUnique.mockResolvedValue({
      config: { aiOverrides: { "pipeline.measure": { provider: "claude", model: "playbook-opus-4-7" } } },
      domainId: "dom-from-call",
    } as any);
    const r = await getAIConfig("pipeline.measure", { callId: "call-1" });
    expect(callFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "call-1" } }));
    expect(playbookFindUnique).toHaveBeenCalled();
    expect(r.model).toBe("playbook-opus-4-7");
  });

  it("partial overrides merge per-field — Playbook model + Domain temperature + global maxTokens", async () => {
    playbookFindUnique.mockResolvedValue({
      config: { aiOverrides: { "pipeline.measure": { model: "playbook-opus-4-7" } } },
      domainId: "dom-1",
    } as any);
    domainFindUnique.mockResolvedValue({
      config: { aiOverrides: { "pipeline.measure": { temperature: 0.42 } } },
    } as any);
    aiConfigFindUnique.mockResolvedValue({
      callPoint: "pipeline.measure",
      provider: "claude",
      model: "global-sonnet-4-6",
      maxTokens: 8000,
      temperature: 0.1,
      timeoutMs: null,
      isActive: true,
    } as any);
    const r = await getAIConfig("pipeline.measure", { playbookId: "pb-1" });
    expect(r.model).toBe("playbook-opus-4-7");      // Playbook
    expect(r.temperature).toBe(0.42);                 // Domain
    expect(r.maxTokens).toBe(8000);                   // global
    expect(r.modelLayer).toBe("playbook");
  });

  it("legacy flat call — getAIConfig(callPoint) with no scope behaves unchanged", async () => {
    playbookFindUnique.mockResolvedValue({
      config: { aiOverrides: { "pipeline.measure": { model: "should-not-win" } } },
      domainId: "dom-1",
    } as any);
    aiConfigFindUnique.mockResolvedValue({
      callPoint: "pipeline.measure",
      provider: "claude",
      model: "global-sonnet-4-6",
      maxTokens: null,
      temperature: null,
      timeoutMs: null,
      isActive: true,
    } as any);
    const r = await getAIConfig("pipeline.measure");
    expect(r.model).toBe("global-sonnet-4-6");
    expect(r.modelLayer).toBe("global");
    // Playbook lookup should NOT have fired.
    expect(playbookFindUnique).not.toHaveBeenCalled();
  });

  it("inactive AIConfig row is ignored — falls through to SystemSettings", async () => {
    aiConfigFindUnique.mockResolvedValue({
      callPoint: "pipeline.measure",
      provider: "claude",
      model: "inactive-model",
      maxTokens: null,
      temperature: null,
      timeoutMs: null,
      isActive: false,
    } as any);
    fallbackMock.mockResolvedValue({
      "pipeline.measure": { provider: "claude", model: "system-sonnet-4-6" } as any,
    });
    const r = await getAIConfig("pipeline.measure");
    expect(r.model).toBe("system-sonnet-4-6");
    expect(r.modelLayer).toBe("system");
  });

  it("cache key includes scope — Playbook A and Playbook B do not collide", async () => {
    playbookFindUnique.mockImplementation((args: any) => {
      if (args.where.id === "pb-A") {
        return Promise.resolve({
          config: { aiOverrides: { "pipeline.measure": { model: "model-A" } } },
          domainId: null,
        }) as any;
      }
      return Promise.resolve({
        config: { aiOverrides: { "pipeline.measure": { model: "model-B" } } },
        domainId: null,
      }) as any;
    });
    const a = await getAIConfig("pipeline.measure", { playbookId: "pb-A" });
    const b = await getAIConfig("pipeline.measure", { playbookId: "pb-B" });
    expect(a.model).toBe("model-A");
    expect(b.model).toBe("model-B");
    expect(playbookFindUnique).toHaveBeenCalledTimes(2);
  });
});
