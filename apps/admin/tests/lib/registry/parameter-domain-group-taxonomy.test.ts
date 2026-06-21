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

  it("parameter count is 163 (registry sanity check)", () => {
    // 2026-06-21 — #2151 added BEH-INTERNAL-LEAK (supervision) — SUPERVISE-alarm
    // signal for LEAK-SCAN-001 runtime gate. Bump 154 → 155.
    // 2026-06-21 — #2196 added 4 IELTS skill_* (learner-model) + 4 prosody_raw_*
    // (voice-delivery) — closes the canonical-registry coverage gap surfaced by
    // PR #2195 #2139. Bump 155 → 163.
    expect(registry.parameters.length).toBe(163);
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
      // 2026-06-21 — #2151 BEH-INTERNAL-LEAK (SUPERVISE-alarm) bumps supervision 12 → 13.
      supervision: 13,
      "behavior-core": 6,
      reinforcement: 6,
      onboarding: 5,
      // 2026-06-21 — #2196 unblocks two pedagogy-review placeholders that were
      // empty at the #1948 v1.0 baseline. The 4 IELTS skill_* params measure
      // learner-state language ability — they ARE the learner-model.
      "learner-model": 4,
      // 2026-06-21 — #2196. The 4 prosody_raw_* params are vendor-derived
      // audio-feature signals (computedBy: prosody-vendor seed); their natural
      // home is voice-delivery per the canonical 12-tuple in
      // lib/registry/canonical-domain-group.ts.
      "voice-delivery": 4,
    });
  });

  it("`voice-delivery` carries the 4 prosody_raw_* vendor signals (#2196)", () => {
    expect(CANONICAL_GROUPS).toContain("voice-delivery");
    const voiceDelivery = registry.parameters.filter(
      (p) => p.domainGroup === "voice-delivery",
    );
    // #2196 — populated by the 4 prosody_raw_* (FC/P/LR/GRA) vendor-derived
    // audio-feature signals; lib/pipeline/prosody-consumer.ts writes them at
    // AGGREGATE when the prosody envelope mode is 'ielts'. Optionally
    // consumed by IELTS-MEASURE-001 via tool-use (post-MVP).
    expect(voiceDelivery.map((p) => p.parameterId).sort()).toEqual([
      "prosody_raw_fc",
      "prosody_raw_gra",
      "prosody_raw_lr",
      "prosody_raw_p",
    ]);
  });

  it("`learner-model` carries the 4 IELTS skill_* per-criterion scores (#2196)", () => {
    expect(CANONICAL_GROUPS).toContain("learner-model");
    const learnerModel = registry.parameters.filter(
      (p) => p.domainGroup === "learner-model",
    );
    // #2196 — populated by the 4 IELTS skill_* (FC/LR/GRA/P) LLM-judged
    // per-criterion band scores measured by IELTS-MEASURE-001 from transcript.
    // SKILL-AGG-001 closes the M2 loop via sourceParameterPattern: "skill_*".
    expect(learnerModel.map((p) => p.parameterId).sort()).toEqual([
      "skill_fluency_and_coherence_fc",
      "skill_grammatical_range_and_accuracy_gra",
      "skill_lexical_resource_lr",
      "skill_pronunciation_p",
    ]);
  });

  it("`affect-motivation` is declared per pedagogy review (placeholder, empty at v1.0)", () => {
    expect(CANONICAL_GROUPS).toContain("affect-motivation");
    const affectMotivation = registry.parameters.filter(
      (p) => p.domainGroup === "affect-motivation",
    );
    expect(affectMotivation).toEqual([]);
  });
});
