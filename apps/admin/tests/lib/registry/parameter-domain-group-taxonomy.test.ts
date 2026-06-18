/**
 * Tests for the canonical domainGroup taxonomy (#1948 — epic #1946 S3).
 *
 * Pins:
 *   1. Every parameter's `domainGroup` matches one of the 10 canonical names
 *      enumerated in the registry JSON header.
 *   2. The registry JSON header carries `taxonomyVersion: "v1.0"` and the
 *      `domainGroups[]` enumeration.
 *   3. No legacy variant spellings remain in the registry (no underscores
 *      where the canonical uses hyphens; no broad-bucket names like `learning`
 *      or `curriculum` standalone).
 *   4. The distribution sums to 154 parameters (matches `docs/PARAMETER-TAXONOMY.md`).
 *
 * Companion to the migration `20260618130000_1948_domain_group_taxonomy`.
 */

import { describe, it, expect } from "vitest";
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
  domainGroup: string;
}

interface Registry {
  taxonomyVersion?: string;
  domainGroups?: string[];
  parameters: RegistryEntry[];
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as Registry;

const CANONICAL_GROUPS = [
  "behavior-core",
  "learning-adaptation",
  "curriculum-adaptation",
  "personality-adaptation",
  "supervision",
  "companion",
  "engagement",
  "reinforcement",
  "onboarding",
  "voice-delivery",
  // #1948 — pedagogy-review placeholders (2026-06-18 review). Empty at
  // v1.0 merge; populated by future curation passes that move
  // learner-state and affect parameters out of `learning-adaptation`.
  "learner-model",
  "affect-motivation",
] as const;

// Legacy variant spellings that the migration normalises. If any of these
// appear post-migration the test fails — the migration was incomplete or
// a new parameter landed using a legacy spelling.
const LEGACY_VARIANTS = [
  "learning_adaptation",
  "learning",
  "interaction_adaptation",
  "pacing_adaptation",
  "curriculum",
  "personality",
  "companion-behavior",
  "engagement_adaptation",
  "feedback_adaptation",
  "style",
];

describe("#1948 — domainGroup canonical taxonomy", () => {
  it("registry header declares taxonomyVersion v1.0", () => {
    expect(registry.taxonomyVersion).toBe("v1.0");
  });

  it("registry header declares the 10 canonical domainGroups", () => {
    expect(registry.domainGroups).toEqual([...CANONICAL_GROUPS]);
  });

  it("every parameter's domainGroup is one of the 10 canonical names", () => {
    const offenders = registry.parameters.filter(
      (p) => !CANONICAL_GROUPS.includes(p.domainGroup as (typeof CANONICAL_GROUPS)[number]),
    );
    expect(
      offenders,
      `Parameters using non-canonical domainGroup:\n  ${offenders
        .slice(0, 10)
        .map((p) => `${p.parameterId} → ${p.domainGroup}`)
        .join("\n  ")}` +
        (offenders.length > 10 ? `\n  ... ${offenders.length - 10} more` : ""),
    ).toEqual([]);
  });

  it("no legacy variant spellings remain in the registry", () => {
    const stragglers = registry.parameters.filter((p) =>
      LEGACY_VARIANTS.includes(p.domainGroup),
    );
    expect(
      stragglers,
      `Parameters still using legacy variant spellings (migration incomplete):\n  ${stragglers
        .map((p) => `${p.parameterId} → ${p.domainGroup}`)
        .join("\n  ")}`,
    ).toEqual([]);
  });

  it("parameter count is 154 (registry sanity check)", () => {
    expect(registry.parameters.length).toBe(154);
  });

  it("distribution matches docs/PARAMETER-TAXONOMY.md after migration", () => {
    const distribution: Record<string, number> = {};
    for (const p of registry.parameters) {
      distribution[p.domainGroup] = (distribution[p.domainGroup] ?? 0) + 1;
    }
    expect(distribution).toEqual({
      "learning-adaptation": 49,
      "curriculum-adaptation": 32,
      companion: 17,
      "personality-adaptation": 14,
      engagement: 13,
      supervision: 12,
      "behavior-core": 6,
      reinforcement: 6,
      onboarding: 5,
      // voice-delivery omitted — empty placeholder for #1952 / S5
    });
  });

  it("`voice-delivery` is declared in canonical groups even though empty (S5 placeholder)", () => {
    expect(CANONICAL_GROUPS).toContain("voice-delivery");
    const voiceDelivery = registry.parameters.filter(
      (p) => p.domainGroup === "voice-delivery",
    );
    // Until #1952 / S5 ships, voice-delivery is intentionally empty.
    expect(voiceDelivery).toEqual([]);
  });

  it("`learner-model` is declared per pedagogy review (placeholder, empty at v1.0)", () => {
    expect(CANONICAL_GROUPS).toContain("learner-model");
    const learnerModel = registry.parameters.filter(
      (p) => p.domainGroup === "learner-model",
    );
    expect(learnerModel).toEqual([]);
  });

  it("`affect-motivation` is declared per pedagogy review (placeholder, empty at v1.0)", () => {
    expect(CANONICAL_GROUPS).toContain("affect-motivation");
    const affectMotivation = registry.parameters.filter(
      (p) => p.domainGroup === "affect-motivation",
    );
    expect(affectMotivation).toEqual([]);
  });
});
