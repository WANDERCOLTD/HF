/**
 * Phase A coverage for #2087 (S2 of #2078).
 *
 * Pins the 13 trivial prompt-injection wires added to the canonical
 * registry. Each parameter now carries a `promptInjection` block;
 * `parametersAsDirectives` (the #1907 dispatcher) emits one directive
 * per parameter into the named section when the cascade resolves to a
 * non-default value.
 *
 * What this test verifies:
 *   1. Each Phase A parameter has a `promptInjection` block in the
 *      canonical registry.
 *   2. Each block targets the expected STYLE / MODALITY section.
 *   3. Each block carries non-empty `templateLow` AND `templateHigh`.
 *   4. Each block declares `condition: "when-non-default"` so the
 *      dispatcher skips emission at the SYSTEM default (no noise
 *      added when the operator hasn't tuned).
 *   5. The dispatcher emits a directive for one representative param
 *      (BEH-ACTION-VERBS) when the cascade returns a high effective
 *      value.
 *
 * Why grouped: 13 single-param tests would be 13 near-identical
 * harnesses. The grouped table-driven approach pins the same
 * structural contract for every entry.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REGISTRY_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "docs-archive",
  "bdd-specs",
  "behavior-parameters.registry.json",
);

interface RegistryEntry {
  parameterId: string;
  defaultTarget: number;
  promptInjection?: {
    section: string;
    condition?: string;
    template?: string;
    templateLow?: string;
    templateHigh?: string;
    threshold?: number;
  };
  usage?: { compose?: string };
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as {
  parameters: RegistryEntry[];
};

const byId = new Map(registry.parameters.map((p) => [p.parameterId, p]));

// The 13 trivial prompt-injection wires landed in this PR. Section
// assignment follows the survey's STYLE / MODALITY split.
const PHASE_A_EXPECTED: ReadonlyArray<{
  id: string;
  section: "STYLE" | "MODALITY";
}> = [
  { id: "BEH-ACTION-VERBS", section: "STYLE" },
  { id: "BEH-DEFINITION-PRECISION", section: "STYLE" },
  { id: "BEH-LIST-STRUCTURE", section: "STYLE" },
  { id: "BEH-REAL-WORLD-EXAMPLES", section: "STYLE" },
  { id: "BEH-TERMINOLOGY-FORMAL", section: "STYLE" },
  { id: "BEH-VERBAL-ELABORATION", section: "STYLE" },
  { id: "BEH-REPETITION-OFFER", section: "STYLE" },
  { id: "BEH-DIAGRAM-LANGUAGE", section: "MODALITY" },
  { id: "BEH-FEELING-LANGUAGE", section: "MODALITY" },
  { id: "BEH-IMAGERY-DENSITY", section: "MODALITY" },
  { id: "BEH-SPATIAL-METAPHOR", section: "MODALITY" },
  { id: "BEH-RHYTHM-ATTENTION", section: "MODALITY" },
  { id: "BEH-WRITTEN-ALTERNATIVE", section: "MODALITY" },
];

describe("Phase A — 13 trivial learning-style prompt-injection wires (#2087)", () => {
  it("has exactly 13 entries listed in this test (sanity)", () => {
    expect(PHASE_A_EXPECTED).toHaveLength(13);
  });

  for (const { id, section } of PHASE_A_EXPECTED) {
    describe(id, () => {
      const entry = byId.get(id);

      it("exists in the canonical registry", () => {
        expect(entry, `Parameter ${id} not found in registry`).toBeDefined();
      });

      it("carries a promptInjection block", () => {
        expect(entry?.promptInjection, `${id} missing promptInjection`).toBeDefined();
      });

      it(`targets the ${section} section`, () => {
        expect(entry?.promptInjection?.section).toBe(section);
      });

      it("declares condition: when-non-default (skips emission at SYSTEM default)", () => {
        expect(entry?.promptInjection?.condition).toBe("when-non-default");
      });

      it("carries non-empty bipolar templateLow + templateHigh", () => {
        const inj = entry?.promptInjection;
        expect(inj?.templateLow).toBeTruthy();
        expect(inj?.templateLow?.length ?? 0).toBeGreaterThan(20);
        expect(inj?.templateHigh).toBeTruthy();
        expect(inj?.templateHigh?.length ?? 0).toBeGreaterThan(20);
      });

      it("declares threshold 0.5 (canonical bipolar split)", () => {
        expect(entry?.promptInjection?.threshold).toBe(0.5);
      });

      it("declares usage.compose: prompt-injection (reflects the wiring)", () => {
        expect(entry?.usage?.compose).toBe("prompt-injection");
      });
    });
  }
});

// ────────────────────────────────────────────────────────────────────
// Live dispatch — verify the dispatcher actually emits a directive
// for one representative Phase A parameter (BEH-ACTION-VERBS) when
// the cascade returns a high effective value. The other 12 follow
// the same dispatcher code path; this single live test confirms the
// wire reaches the directive list.
// ────────────────────────────────────────────────────────────────────

const mockGetEffectiveBehaviorTargetsForCaller = vi.fn();

vi.mock("@/lib/tolerance/getEffectiveBehaviorTargetsForCaller", () => ({
  getEffectiveBehaviorTargetsForCaller: (...args: unknown[]) =>
    mockGetEffectiveBehaviorTargetsForCaller(...args),
}));

import "@/lib/prompt/composition/transforms/parametersAsDirectives";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";

describe("Phase A — dispatcher live emission (representative)", () => {
  const transform = getTransform("parametersAsDirectives")!;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits a STYLE directive when BEH-ACTION-VERBS resolves high (≥0.5)", async () => {
    mockGetEffectiveBehaviorTargetsForCaller.mockResolvedValue([
      {
        parameterId: "BEH-ACTION-VERBS",
        effectiveValue: 0.85, // > threshold → templateHigh
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

    expect(out.directiveCount).toBeGreaterThanOrEqual(1);
    const styleSection = out.sections.find(
      (s: { section: string }) => s.section === "STYLE",
    );
    expect(styleSection).toBeDefined();
    expect(
      styleSection.directives.some((d: string) => /action/i.test(d)),
    ).toBe(true);
  });

  it("emits a MODALITY directive when BEH-DIAGRAM-LANGUAGE resolves low (<0.5)", async () => {
    mockGetEffectiveBehaviorTargetsForCaller.mockResolvedValue([
      {
        parameterId: "BEH-DIAGRAM-LANGUAGE",
        effectiveValue: 0.15, // < threshold → templateLow
        sourceScope: "CALLER",
        systemValue: 0.5,
        playbookValue: null,
        callerValue: 0.15,
      },
    ]);

    const out: any = await transform(
      { playbookId: "pb-1", callerId: "c-1" },
      {} as any,
      {} as any,
    );

    expect(out.directiveCount).toBeGreaterThanOrEqual(1);
    const modalitySection = out.sections.find(
      (s: { section: string }) => s.section === "MODALITY",
    );
    expect(modalitySection).toBeDefined();
    expect(
      modalitySection.directives.some((d: string) =>
        /narrative|sequential/i.test(d),
      ),
    ).toBe(true);
  });

  it("skips emission for Phase A params at the SYSTEM default (when-non-default contract)", async () => {
    mockGetEffectiveBehaviorTargetsForCaller.mockResolvedValue([
      {
        parameterId: "BEH-VERBAL-ELABORATION",
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

    // Only this param was returned by the mock; default = no directive.
    expect(out.directiveCount).toBe(0);
  });
});
