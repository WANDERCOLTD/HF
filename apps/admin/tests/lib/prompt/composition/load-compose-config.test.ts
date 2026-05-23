/**
 * Tests for `loadComposeConfig` spec-lookup robustness.
 *
 * Root cause we're guarding against: pre-2026-05-23 the fallback query was
 * too permissive — it matched any active SYSTEM-scope spec with
 * `outputType: "COMPOSE"`, which included identity-domain archetypes
 * (ADVISOR-001, COACH-001, …) and the spec-{role}-001 overlays.
 * `findFirst()` without `orderBy` returned non-deterministically, so some
 * compositions picked the real COMP-001 (correct) and others picked
 * ADVISOR-001 (wrong) — surfacing as `inputs.specUsed = "spec-advisor-001"`
 * on ComposedPrompt rows and tripping the `advisorInInputsSnapshot`
 * audit counter.
 *
 * Fix: tighten the fallback to `domain: "prompt-composition"` and add
 * `orderBy: slug asc` for determinism. The exact-slug match still wins
 * when env is configured.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  configCompose: "spec-comp-001",
  warn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { analysisSpec: { findFirst: mocks.findFirst } },
}));

vi.mock("@/lib/config", () => ({
  config: {
    specs: {
      get compose() {
        return mocks.configCompose;
      },
    },
  },
}));

vi.mock("@/lib/prompt/composition/CompositionExecutor", () => ({
  getDefaultSections: () => [],
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configCompose = "spec-comp-001";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => mocks.warn(...args));
});

import { loadComposeConfig } from "@/lib/prompt/composition/loadComposeConfig";

describe("loadComposeConfig — spec lookup robustness", () => {
  it("uses the env-configured slug when it exists (exact-match wins)", async () => {
    mocks.findFirst.mockResolvedValueOnce({
      id: "1",
      slug: "spec-comp-001",
      config: { sections: [{ id: "x" }] },
    });
    const result = await loadComposeConfig();
    expect(result.specSlug).toBe("spec-comp-001");
    expect(mocks.findFirst).toHaveBeenCalledTimes(1);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { slug: "spec-comp-001", isActive: true },
    });
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("falls back to domain=prompt-composition when env slug is missing", async () => {
    mocks.findFirst.mockResolvedValueOnce(null); // exact-match miss
    mocks.findFirst.mockResolvedValueOnce({
      id: "2",
      slug: "spec-comp-002",
      config: { sections: [] },
    });
    const result = await loadComposeConfig();
    expect(result.specSlug).toBe("spec-comp-002");
    expect(mocks.findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        outputType: "COMPOSE",
        isActive: true,
        scope: "SYSTEM",
        domain: "prompt-composition",
      },
      orderBy: { slug: "asc" },
    });
  });

  it("does NOT match identity-domain archetypes on fallback (the root-cause bug)", async () => {
    mocks.configCompose = "bogus-slug-does-not-exist";
    mocks.findFirst.mockResolvedValueOnce(null); // exact-match miss
    mocks.findFirst.mockResolvedValueOnce(null); // tightened fallback finds nothing
    await expect(loadComposeConfig()).rejects.toThrow(/COMPOSE spec not found/);
    expect(mocks.findFirst).toHaveBeenCalledTimes(2);
    const fallbackCall = mocks.findFirst.mock.calls[1][0] as {
      where: { domain: string };
    };
    // Critical: the fallback MUST require domain="prompt-composition" so
    // that identity-domain archetypes (which have outputType=COMPOSE) are
    // never matched.
    expect(fallbackCall.where.domain).toBe("prompt-composition");
  });

  // Note: loadComposeConfig also emits a separate warning when the spec has
  // no sections[] config (using hardcoded defaults). Our tests pass mocks
  // with `sections: [{}]` to avoid that second warning and isolate the
  // fallback-warning assertions.
  it("warns when the env slug misses and fallback picks a substitute", async () => {
    mocks.configCompose = "system-compose-next-prompt"; // legacy/broken default
    mocks.findFirst.mockResolvedValueOnce(null);
    mocks.findFirst.mockResolvedValueOnce({
      id: "3",
      slug: "spec-comp-001",
      config: { sections: [{ id: "x" }] },
    });
    await loadComposeConfig();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    const warnMsg = String(mocks.warn.mock.calls[0][0]);
    expect(warnMsg).toContain("loadComposeConfig");
    expect(warnMsg).toContain("system-compose-next-prompt");
    expect(warnMsg).toContain("spec-comp-001");
  });

  it("does NOT warn when the exact-match query succeeds", async () => {
    mocks.findFirst.mockResolvedValueOnce({
      id: "1",
      slug: "spec-comp-001",
      config: { sections: [{ id: "x" }] },
    });
    await loadComposeConfig();
    // The only warn this path can emit is the fallback notice (covered by
    // the previous test); since exact-match succeeded, no warn should fire.
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("uses orderBy slug asc on the fallback for determinism", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    mocks.findFirst.mockResolvedValueOnce({
      id: "1",
      slug: "spec-comp-001",
      config: { sections: [] },
    });
    await loadComposeConfig();
    const fallbackCall = mocks.findFirst.mock.calls[1][0] as {
      orderBy: { slug: string };
    };
    expect(fallbackCall.orderBy).toEqual({ slug: "asc" });
  });
});
