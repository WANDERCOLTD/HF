/**
 * #599 Slice 1 — AI-surface safety rails on `update_playbook_config` for
 * the `priorCallRecap` block.
 *
 * These tests exercise the validator/clamp directly without spinning up the
 * full handler dispatch. The complementary meta-test in
 * `tests/lib/admin-tools-no-forbidden-fields.test.ts` covers the
 * `system_setting` forbidden-fields entry that backs the allowlist tripwire.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validatePriorCallRecapUpdates } from "@/lib/chat/admin-tool-handlers";

describe("validatePriorCallRecapUpdates — pass-through cases", () => {
  it("returns updates unchanged when priorCallRecap is absent", () => {
    const result = validatePriorCallRecapUpdates({ sessionCount: 5, durationMins: 6 });
    expect(result).toEqual({ normalised: { sessionCount: 5, durationMins: 6 } });
  });

  it("allows explicit null to clear the field", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: null });
    expect(result.error).toBeUndefined();
    expect(result.normalised).toEqual({ priorCallRecap: null });
  });
});

describe("validatePriorCallRecapUpdates — shape validation", () => {
  it("rejects array shape", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: [] });
    expect(result.error).toBeDefined();
    expect(result.error).toContain("priorCallRecap must be an object");
  });

  it("rejects string shape", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: "rich" });
    expect(result.error).toContain("priorCallRecap must be an object");
  });

  it("rejects non-boolean enabled", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: { enabled: "yes" } });
    expect(result.error).toContain("priorCallRecap.enabled must be a boolean");
  });
});

describe("validatePriorCallRecapUpdates — depth enum validation", () => {
  it("accepts 'minimal'", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: { depth: "minimal" } });
    expect(result.error).toBeUndefined();
    expect(result.normalised?.priorCallRecap).toEqual({ depth: "minimal" });
  });

  it("accepts 'standard'", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: { depth: "standard" } });
    expect(result.normalised?.priorCallRecap).toEqual({ depth: "standard" });
  });

  it("accepts 'rich'", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: { depth: "rich" } });
    expect(result.normalised?.priorCallRecap).toEqual({ depth: "rich" });
  });

  it.each([
    ["Maximum"],
    ["RICH"],
    [""],
    ["minimal "],
  ])("rejects unknown depth %j", (depth) => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: { depth } });
    expect(result.error).toBeDefined();
    expect(result.error).toContain("priorCallRecap.depth must be one of");
  });

  it("rejects non-string depth (number)", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: { depth: 1 } });
    expect(result.error).toBeDefined();
  });

  it("rejects null depth", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: { depth: null } });
    expect(result.error).toBeDefined();
  });
});

describe("validatePriorCallRecapUpdates — dailyCap clamp", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("passes through in-range values unchanged", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: { dailyCap: 100 } });
    expect(result.error).toBeUndefined();
    expect((result.normalised?.priorCallRecap as { dailyCap: number }).dailyCap).toBe(100);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("clamps over-limit values to 500 and warns", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: { dailyCap: 99999 } });
    expect(result.error).toBeUndefined();
    expect((result.normalised?.priorCallRecap as { dailyCap: number }).dailyCap).toBe(500);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0][0]);
    expect(message).toMatch(/clamped 99999 → 500/);
  });

  it("clamps negatives to 0 and warns", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: { dailyCap: -5 } });
    expect((result.normalised?.priorCallRecap as { dailyCap: number }).dailyCap).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("floors fractional values", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: { dailyCap: 12.9 } });
    expect((result.normalised?.priorCallRecap as { dailyCap: number }).dailyCap).toBe(12);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects non-finite numbers", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: { dailyCap: Number.POSITIVE_INFINITY } });
    expect(result.error).toContain("priorCallRecap.dailyCap must be a finite number");
  });

  it("rejects non-number dailyCap", () => {
    const result = validatePriorCallRecapUpdates({ priorCallRecap: { dailyCap: "50" } });
    expect(result.error).toContain("priorCallRecap.dailyCap must be a finite number");
  });
});

describe("validatePriorCallRecapUpdates — composite update", () => {
  it("normalises a full {enabled, depth, dailyCap} block and preserves siblings", () => {
    const result = validatePriorCallRecapUpdates({
      sessionCount: 5,
      priorCallRecap: { enabled: true, depth: "rich", dailyCap: 30 },
      durationMins: 6,
    });
    expect(result.error).toBeUndefined();
    expect(result.normalised).toEqual({
      sessionCount: 5,
      priorCallRecap: { enabled: true, depth: "rich", dailyCap: 30 },
      durationMins: 6,
    });
  });
});
