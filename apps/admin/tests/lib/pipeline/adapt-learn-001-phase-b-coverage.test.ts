/**
 * Phase B coverage for #2087 (S2 of #2078).
 *
 * Pins the 18 spec-driven ADAPT-LEARN-001 branches that wire the
 * producer-only learning-style parameters. Each Phase B param now
 * appears as a `targetParameter` in at least one adaptationRules
 * action under one of the two new top-level spec parameters:
 *
 *   - `adapt_to_vark_modality` — VARK + modality params keyed on
 *     `learningStyle` (visual / reading / auditory / kinesthetic).
 *   - `adapt_to_interaction_extensions` — interaction-shape params
 *     keyed on `interactionStyle` / `feedbackStyle` /
 *     `questionFrequency`.
 *
 * `adapt-runner.ts` already consumes ADAPT spec parameters generically
 * — it walks `parameters[].config.adaptationRules[]`, evaluates each
 * rule's condition against the learner profile, and writes
 * `CallerTarget` rows for every action whose target matches a real
 * `Parameter` row. No runner change is needed.
 *
 * The parameter-coverage test (`parameter-coverage.test.ts`) now
 * scans `docs-archive/bdd-specs/ADAPT-*.spec.json` as consumer source,
 * so these spec-driven wires count as `covered` without a literal
 * mention in TypeScript code.
 *
 * What this test verifies:
 *   1. The 18 Phase B params each appear as a `targetParameter` at
 *      least once across the spec's adaptationRules.
 *   2. The two new top-level spec parameters exist with the right
 *      `id` and structure.
 *   3. Every action in the new branches carries a valid `adjustment`
 *      method + value/delta and a non-trivial rationale.
 *   4. Every condition references one of the canonical learner-
 *      profile keys consumed by `adapt-runner.ts` (`learningStyle`
 *      / `interactionStyle` / `feedbackStyle` / `questionFrequency`).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SPEC_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "docs-archive",
  "bdd-specs",
  "ADAPT-LEARN-001-learner-profile-adaptation.spec.json",
);

interface AdaptAction {
  targetParameter: string;
  adjustment: "set" | "increase" | "decrease";
  value?: number;
  delta?: number;
  rationale?: string;
}

interface AdaptRule {
  condition: { profileKey: string; value?: string | number };
  actions: AdaptAction[];
}

interface SpecParameter {
  id: string;
  name?: string;
  section?: string;
  config?: { adaptationRules?: AdaptRule[] };
}

interface Spec {
  id: string;
  parameters: SpecParameter[];
}

const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as Spec;

const PHASE_B_IDS: ReadonlyArray<string> = [
  "BEH-ADAPT-TO-FEEDBACK-STYLE",
  "BEH-ADAPT-TO-INTERACTION-STYLE",
  "BEH-ADAPT-TO-QUESTION-FREQUENCY",
  "BEH-AGGREGATE-PROFILE",
  "analogy-usage",
  "BEH-ABSTRACT-OK",
  "BEH-APPROACH-SWITCHING",
  "BEH-MODALITY-CONSISTENCY",
  "BEH-MODALITY-VARIETY",
  "BEH-PRACTICE-EXERCISES",
  "BEH-ENGAGEMENT-PROMPTS",
  "BEH-ENGAGEMENT-WITH-EXAMPLES",
  "BEH-MULTIMODAL-ADAPTATION",
  "BEH-QUESTION-ASKING-RATE",
  "BEH-READING-WRITING-ADAPTATION",
  "repetition-frequency",
  "BEH-RESPONSE-LENGTH-PREFERENCE",
  "VARK-PROFILE",
];

const CANONICAL_PROFILE_KEYS = new Set([
  "learningStyle",
  "interactionStyle",
  "feedbackStyle",
  "questionFrequency",
  "pacePreference",
]);

const allTargetParameters: string[] = [];
for (const p of spec.parameters) {
  for (const rule of p.config?.adaptationRules ?? []) {
    for (const action of rule.actions) {
      allTargetParameters.push(action.targetParameter);
    }
  }
}
const targetParameterSet = new Set(allTargetParameters);

describe("ADAPT-LEARN-001 — Phase B 18-param coverage (#2087)", () => {
  it("has exactly 18 Phase B ids listed in this test (sanity)", () => {
    expect(PHASE_B_IDS).toHaveLength(18);
  });

  it("declares the new adapt_to_vark_modality top-level spec parameter", () => {
    const p = spec.parameters.find((x) => x.id === "adapt_to_vark_modality");
    expect(p, "adapt_to_vark_modality missing from spec").toBeDefined();
    expect(p?.section).toBe("modality_adaptation");
    expect(p?.config?.adaptationRules?.length ?? 0).toBeGreaterThan(0);
  });

  it("declares the new adapt_to_interaction_extensions top-level spec parameter", () => {
    const p = spec.parameters.find(
      (x) => x.id === "adapt_to_interaction_extensions",
    );
    expect(p, "adapt_to_interaction_extensions missing from spec").toBeDefined();
    expect(p?.section).toBe("interaction_adaptation");
    expect(p?.config?.adaptationRules?.length ?? 0).toBeGreaterThan(0);
  });

  for (const paramId of PHASE_B_IDS) {
    it(`${paramId} appears as a targetParameter in at least one adaptationRule`, () => {
      expect(
        targetParameterSet.has(paramId),
        `Phase B param ${paramId} not found in any adaptationRule action`,
      ).toBe(true);
    });
  }

  it("every Phase B action carries adjustment: set with a numeric value in [0, 1]", () => {
    for (const p of spec.parameters) {
      if (
        p.id !== "adapt_to_vark_modality" &&
        p.id !== "adapt_to_interaction_extensions"
      )
        continue;
      for (const rule of p.config?.adaptationRules ?? []) {
        for (const action of rule.actions) {
          expect(
            action.adjustment,
            `${p.id} → ${action.targetParameter} missing adjustment`,
          ).toBe("set");
          expect(
            action.value,
            `${p.id} → ${action.targetParameter} missing value`,
          ).toBeDefined();
          expect(action.value).toBeGreaterThanOrEqual(0);
          expect(action.value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("every Phase B action carries a non-trivial rationale (>10 chars)", () => {
    for (const p of spec.parameters) {
      if (
        p.id !== "adapt_to_vark_modality" &&
        p.id !== "adapt_to_interaction_extensions"
      )
        continue;
      for (const rule of p.config?.adaptationRules ?? []) {
        for (const action of rule.actions) {
          expect(
            (action.rationale ?? "").trim().length,
            `${p.id} → ${action.targetParameter} short/empty rationale`,
          ).toBeGreaterThan(10);
        }
      }
    }
  });

  it("every Phase B condition references a canonical learner-profile key", () => {
    for (const p of spec.parameters) {
      if (
        p.id !== "adapt_to_vark_modality" &&
        p.id !== "adapt_to_interaction_extensions"
      )
        continue;
      for (const rule of p.config?.adaptationRules ?? []) {
        const key = rule.condition.profileKey;
        expect(
          CANONICAL_PROFILE_KEYS.has(key),
          `${p.id} rule uses unknown profileKey: ${key}`,
        ).toBe(true);
      }
    }
  });
});
