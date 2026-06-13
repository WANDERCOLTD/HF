/**
 * Tests for lib/goals/strategies/registry.ts strategy-key normalization +
 * alias resolution.
 *
 * Background: `Goal.progressStrategy` is persisted as uppercase `LO_MASTERY`
 * by `scripts/fix-cio-cto-playbooks.ts:234` and a handful of older seed
 * scripts. The registry registers the strategy under the lowercase key
 * `lo_rollup`. Without normalization the lookup falls through to
 * `manual_only` and every LEARN goal sits at 0% forever.
 *
 * The registry now lowercases the requested key, then applies the
 * STRATEGY_ALIASES map. Add new aliases only when forced by historical
 * data — every new strategy should register with its canonical key.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerStrategy,
  getStrategy,
  _resetRegistryForTests,
} from "@/lib/goals/strategies/registry";
import type { StrategyFn } from "@/lib/goals/strategies/types";

const noopProgress: StrategyFn = async () => null;

function makeMarker(name: string): StrategyFn {
  const fn: StrategyFn = async () => ({
    goalId: "marker:" + name,
    progressDelta: 0,
    evidence: name,
  });
  return fn;
}

beforeEach(() => {
  _resetRegistryForTests();
  registerStrategy("manual_only", noopProgress);
});

describe("getStrategy — case insensitivity", () => {
  it("resolves an exact-lowercase key", async () => {
    const fn = makeMarker("lo_rollup");
    registerStrategy("lo_rollup", fn);
    const got = getStrategy("lo_rollup");
    const result = await got({} as any, {} as any);
    expect(result?.evidence).toBe("lo_rollup");
  });

  it("resolves a mixed-case request to the lowercase-registered key", async () => {
    const fn = makeMarker("skill_ema");
    registerStrategy("skill_ema", fn);
    const got = getStrategy("Skill_EMA");
    const result = await got({} as any, {} as any);
    expect(result?.evidence).toBe("skill_ema");
  });
});

describe("getStrategy — historical aliases (LO_MASTERY → lo_rollup)", () => {
  it("routes LO_MASTERY (uppercase) to the registered lo_rollup strategy", async () => {
    const fn = makeMarker("lo_rollup");
    registerStrategy("lo_rollup", fn);
    const got = getStrategy("LO_MASTERY");
    const result = await got({} as any, {} as any);
    expect(result?.evidence).toBe("lo_rollup");
  });

  it("routes lo_mastery (lowercase, alias key form) to lo_rollup", async () => {
    const fn = makeMarker("lo_rollup");
    registerStrategy("lo_rollup", fn);
    const got = getStrategy("lo_mastery");
    const result = await got({} as any, {} as any);
    expect(result?.evidence).toBe("lo_rollup");
  });
});

describe("getStrategy — unknown keys fall back to manual_only", () => {
  it("unknown key returns the manual_only fallback rather than throwing", async () => {
    const manualMarker = makeMarker("manual_only");
    _resetRegistryForTests();
    registerStrategy("manual_only", manualMarker);
    const got = getStrategy("totally-unknown-key");
    const result = await got({} as any, {} as any);
    expect(result?.evidence).toBe("manual_only");
  });

  it("null / undefined / empty key fall back to manual_only", async () => {
    const manualMarker = makeMarker("manual_only");
    _resetRegistryForTests();
    registerStrategy("manual_only", manualMarker);
    for (const key of [null, undefined, ""] as Array<string | null | undefined>) {
      const got = getStrategy(key);
      const result = await got({} as any, {} as any);
      expect(result?.evidence).toBe("manual_only");
    }
  });

  it("throws when manual_only itself isn't registered (sanity guard)", () => {
    _resetRegistryForTests();
    expect(() => getStrategy("anything")).toThrow(/manual_only fallback not registered/);
  });
});
