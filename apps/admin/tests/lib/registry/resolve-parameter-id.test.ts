/**
 * Tests for the alias-aware parameter id resolver (#1949 — epic #1946 S1).
 *
 * Validates the resolution rules:
 *   - canonical id passes through unchanged
 *   - known alias resolves to the canonical id
 *   - unknown id passes through with `found: false`
 *   - empty input is handled defensively
 *   - deprecation timestamp is surfaced for downstream filters
 *   - bulk resolution returns one entry per input id
 *   - cache hits avoid repeat DB reads within TTL
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockParameterFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    parameter: {
      findMany: (...args: unknown[]) => mockParameterFindMany(...args),
    },
  },
}));

import {
  resolveParameterId,
  resolveParameterIds,
  clearAliasCache,
} from "@/lib/registry/resolve";

describe("resolveParameterId (#1949)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAliasCache();
    // Default fixture: BEH-WARMTH is canonical, with `warmth_actual` +
    // `BEH-CONVERSATIONAL-TONE` in its aliases[]. BEH-PACE-MATCH is
    // canonical (no aliases). `legacy_dep` is deprecated (aliased on
    // an already-deprecated row).
    mockParameterFindMany.mockResolvedValue([
      {
        parameterId: "BEH-WARMTH",
        aliases: ["warmth_actual", "BEH-CONVERSATIONAL-TONE"],
        deprecatedAt: null,
      },
      {
        parameterId: "BEH-PACE-MATCH",
        aliases: [],
        deprecatedAt: null,
      },
      {
        parameterId: "legacy_dep",
        aliases: [],
        deprecatedAt: new Date("2026-06-01"),
      },
    ]);
  });

  it("returns canonical id unchanged when input matches a canonical id", async () => {
    const r = await resolveParameterId("BEH-WARMTH");
    expect(r).toEqual({
      canonicalId: "BEH-WARMTH",
      isAlias: false,
      deprecatedAt: null,
      found: true,
    });
  });

  it("resolves a known alias to the canonical id and flags isAlias=true", async () => {
    const r = await resolveParameterId("warmth_actual");
    expect(r).toEqual({
      canonicalId: "BEH-WARMTH",
      isAlias: true,
      deprecatedAt: null,
      found: true,
    });
  });

  it("resolves a second alias to the same canonical id (aliases array fan-out)", async () => {
    const r = await resolveParameterId("BEH-CONVERSATIONAL-TONE");
    expect(r.canonicalId).toBe("BEH-WARMTH");
    expect(r.isAlias).toBe(true);
  });

  it("surfaces deprecation timestamp on a deprecated row", async () => {
    const r = await resolveParameterId("legacy_dep");
    expect(r.canonicalId).toBe("legacy_dep");
    expect(r.deprecatedAt).toEqual(new Date("2026-06-01"));
    expect(r.found).toBe(true);
  });

  it("passes through unknown id with found=false", async () => {
    const r = await resolveParameterId("unknown_id");
    expect(r).toEqual({
      canonicalId: "unknown_id",
      isAlias: false,
      deprecatedAt: null,
      found: false,
    });
  });

  it("handles empty input defensively", async () => {
    const r = await resolveParameterId("");
    expect(r).toEqual({
      canonicalId: "",
      isAlias: false,
      deprecatedAt: null,
      found: false,
    });
    // Empty input short-circuits BEFORE the DB read
    expect(mockParameterFindMany).not.toHaveBeenCalled();
  });

  it("caches the alias map across calls within TTL (one DB read)", async () => {
    await resolveParameterId("BEH-WARMTH");
    await resolveParameterId("warmth_actual");
    await resolveParameterId("BEH-PACE-MATCH");
    expect(mockParameterFindMany).toHaveBeenCalledTimes(1);
  });

  it("clearAliasCache forces a re-read", async () => {
    await resolveParameterId("BEH-WARMTH");
    expect(mockParameterFindMany).toHaveBeenCalledTimes(1);
    clearAliasCache();
    await resolveParameterId("BEH-WARMTH");
    expect(mockParameterFindMany).toHaveBeenCalledTimes(2);
  });
});

describe("resolveParameterIds — bulk variant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAliasCache();
    mockParameterFindMany.mockResolvedValue([
      {
        parameterId: "BEH-WARMTH",
        aliases: ["warmth_actual"],
        deprecatedAt: null,
      },
      {
        parameterId: "BEH-PACE-MATCH",
        aliases: ["pace_indicators", "CONV_PACE"],
        deprecatedAt: null,
      },
    ]);
  });

  it("returns a single map entry per input id (canonical, alias, unknown mix)", async () => {
    const map = await resolveParameterIds([
      "BEH-WARMTH", // canonical
      "warmth_actual", // alias of BEH-WARMTH
      "pace_indicators", // alias of BEH-PACE-MATCH
      "unknown_id",
    ]);

    expect(map.size).toBe(4);
    expect(map.get("BEH-WARMTH")?.canonicalId).toBe("BEH-WARMTH");
    expect(map.get("warmth_actual")?.canonicalId).toBe("BEH-WARMTH");
    expect(map.get("pace_indicators")?.canonicalId).toBe("BEH-PACE-MATCH");
    expect(map.get("unknown_id")?.canonicalId).toBe("unknown_id");
    expect(map.get("unknown_id")?.found).toBe(false);
  });

  it("makes a single DB read for many inputs", async () => {
    await resolveParameterIds(["BEH-WARMTH", "warmth_actual", "pace_indicators"]);
    expect(mockParameterFindMany).toHaveBeenCalledTimes(1);
  });

  it("returns empty map on empty input — no DB read", async () => {
    const map = await resolveParameterIds([]);
    expect(map.size).toBe(0);
    expect(mockParameterFindMany).not.toHaveBeenCalled();
  });
});
