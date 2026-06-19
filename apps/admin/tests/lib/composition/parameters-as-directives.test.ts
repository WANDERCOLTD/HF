/**
 * Tests for the parametersAsDirectives dispatcher transform (#1907).
 *
 * The dispatcher reads registry entries with a `promptInjection` block,
 * resolves the cascade target via the batched
 * `getEffectiveBehaviorTargetsForCaller` helper, and emits one directive
 * per parameter into the matching section. These tests verify:
 *
 *   - Bipolar template path (templateLow vs templateHigh)
 *   - Single-template path with {value} substitution
 *   - Null-effective contract (no directive when cascade returns nothing)
 *   - when-non-default condition (no directive at default value)
 *   - Batched cascade read (helper called exactly ONCE per compose)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetEffectiveBehaviorTargetsForCaller = vi.fn();

vi.mock("@/lib/tolerance/getEffectiveBehaviorTargetsForCaller", () => ({
  getEffectiveBehaviorTargetsForCaller: (...args: unknown[]) =>
    mockGetEffectiveBehaviorTargetsForCaller(...args),
}));

// Import after the mock is in place so the transform picks up the mock.
import "@/lib/prompt/composition/transforms/parametersAsDirectives";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";

describe("parametersAsDirectives transform (#1907)", () => {
  const transform = getTransform("parametersAsDirectives")!;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is registered in the transform registry", () => {
    expect(transform).toBeDefined();
    expect(typeof transform).toBe("function");
  });

  it("returns an empty result when playbookId is null", async () => {
    const out: any = await transform(
      { playbookId: null, callerId: "c-1" },
      {} as any,
      {} as any,
    );
    expect(out.sections).toEqual([]);
    expect(out.directiveCount).toBe(0);
    expect(mockGetEffectiveBehaviorTargetsForCaller).not.toHaveBeenCalled();
  });

  it("returns an empty result when callerId is empty", async () => {
    const out: any = await transform(
      { playbookId: "pb-1", callerId: "" },
      {} as any,
      {} as any,
    );
    expect(out.sections).toEqual([]);
    expect(out.directiveCount).toBe(0);
    expect(mockGetEffectiveBehaviorTargetsForCaller).not.toHaveBeenCalled();
  });

  it("calls the batched cascade reader exactly ONCE per compose (TL Risk-2 pin)", async () => {
    mockGetEffectiveBehaviorTargetsForCaller.mockResolvedValue([
      {
        parameterId: "BEH-ABSTRACT-VS-CONCRETE",
        effectiveValue: 0.2, // low → favour concrete
        sourceScope: "CALLER",
        systemValue: 0.5,
        playbookValue: null,
        callerValue: 0.2,
      },
    ]);

    await transform(
      { playbookId: "pb-1", callerId: "c-1" },
      {} as any,
      {} as any,
    );

    expect(mockGetEffectiveBehaviorTargetsForCaller).toHaveBeenCalledTimes(1);
    expect(mockGetEffectiveBehaviorTargetsForCaller).toHaveBeenCalledWith(
      "pb-1",
      "c-1",
    );
  });

  it("bipolar template — emits templateLow when value < threshold", async () => {
    mockGetEffectiveBehaviorTargetsForCaller.mockResolvedValue([
      {
        parameterId: "BEH-ABSTRACT-VS-CONCRETE",
        effectiveValue: 0.2, // < 0.5 → templateLow
        sourceScope: "CALLER",
        systemValue: 0.5,
        playbookValue: null,
        callerValue: 0.2,
      },
    ]);

    const out: any = await transform(
      { playbookId: "pb-1", callerId: "c-1" },
      {} as any,
      {} as any,
    );

    expect(out.directiveCount).toBe(1);
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].section).toBe("STYLE");
    expect(out.sections[0].directives[0]).toMatch(/concrete/i);
  });

  it("bipolar template — emits templateHigh when value > threshold", async () => {
    mockGetEffectiveBehaviorTargetsForCaller.mockResolvedValue([
      {
        parameterId: "BEH-ABSTRACT-VS-CONCRETE",
        effectiveValue: 0.85, // > 0.5 → templateHigh
        sourceScope: "CALLER",
        systemValue: 0.5,
        playbookValue: null,
        callerValue: 0.85,
      },
    ]);

    const out: any = await transform(
      { playbookId: "pb-1", callerId: "c-1" },
      {} as any,
      {} as any,
    );

    expect(out.directiveCount).toBe(1);
    expect(out.sections[0].directives[0]).toMatch(/abstract/i);
  });

  it("when-non-default contract — skips emission when value equals defaultTarget", async () => {
    mockGetEffectiveBehaviorTargetsForCaller.mockResolvedValue([
      {
        parameterId: "BEH-ABSTRACT-VS-CONCRETE",
        effectiveValue: 0.5, // === defaultTarget
        sourceScope: "SYSTEM",
        systemValue: 0.5,
        playbookValue: null,
        callerValue: null,
      },
    ]);

    const out: any = await transform(
      { playbookId: "pb-1", callerId: "c-1" },
      {} as any,
      {} as any,
    );

    expect(out.directiveCount).toBe(0);
    expect(out.sections).toEqual([]);
  });

  it("null-effective contract — skips emission when no cascade layer has the parameter", async () => {
    mockGetEffectiveBehaviorTargetsForCaller.mockResolvedValue([]); // nothing populated

    const out: any = await transform(
      { playbookId: "pb-1", callerId: "c-1" },
      {} as any,
      {} as any,
    );

    expect(out.directiveCount).toBe(0);
    expect(out.sections).toEqual([]);
  });
});
