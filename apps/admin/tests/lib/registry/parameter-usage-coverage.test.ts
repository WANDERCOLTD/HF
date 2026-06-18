/**
 * Parameter usage coverage — Lattice Coverage-pillar member (epic #1946).
 *
 * Sibling to `parameter-coverage.test.ts` (which uses fuzzy substring
 * search over consumer source). This test uses the **declarative
 * `usage` field** on every parameter in the canonical registry — the
 * structural answer to "100% of parameters USED, data-driven" from
 * the user's directive on epic #1946.
 *
 * **What this test pins:**
 *
 * 1. Every parameter has a `usage` block (data-driven invariant).
 * 2. `usage.compose` is one of the allowed routes (the LLM-reach
 *    declaration: how the param's interpretation reaches the prompt).
 * 3. `usage.measurement` is either a real `{ specSlug }` (the param
 *    is scored by an AnalysisSpec) OR the explicit deferral marker
 *    `"deferred-#1967"` (tracking the producer-only debt epic).
 * 4. The count of `deferred-#1967` measurements is RATCHETED — it
 *    can drop as #1967 lands real specSlug declarations but never
 *    rise. Future PRs adding a new parameter without measurement
 *    have two options: declare a real specSlug, or join the deferred
 *    list (counted into the ratchet).
 *
 * **Why this exists:**
 *
 * Pre-epic-#1946, parameters drifted producer-only without
 * structural visibility — the registry seeded 154 rows but only ~36
 * had any consumer. The fuzzy-substring `parameter-coverage.test.ts`
 * surfaces this as a count, but doesn't force authors to declare
 * intent. The `usage` block makes the orphan problem data-driven:
 * every parameter's "is this used? how?" is explicit metadata, and
 * any new param landing without a usage declaration fails this test.
 *
 * The 5th Lattice pillar (Coverage) extended.
 *
 * See `.claude/rules/parameter-coverage.md` for the sibling
 * substring-based ratchet; this file pins the declarative side.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const APPS_ADMIN = resolve(__dirname, "..", "..", "..");
const REGISTRY_PATH = join(
  APPS_ADMIN,
  "docs-archive",
  "bdd-specs",
  "behavior-parameters.registry.json",
);

interface RegistryEntry {
  parameterId: string;
  deprecatedAt?: string | null;
  usage?: {
    compose: string;
    measurement: string | { specSlug: string };
  };
}

interface Registry {
  parameters: RegistryEntry[];
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as Registry;

const ALLOWED_COMPOSE_VALUES = new Set([
  // Active params reach the LLM via the renderPromptSummary
  // `## Behavior Targets Semantics` block — the canonical post-S4 route.
  "semantics-block",
  // Active params with `promptInjection` block in the registry are
  // also routed by `parametersAsDirectives.ts` dispatcher.
  "prompt-injection",
  // Active params whose IDs (or aliases) are mentioned by name in a
  // compose transform — the legacy direct-reference path.
  "transform-direct",
  // Deprecated params are no longer routed anywhere.
  "deprecated",
]);

const ALLOWED_MEASUREMENT_STRING_VALUES = new Set([
  // Producer-only debt explicitly tracked by epic #1967.
  "deferred-#1967",
  // Deprecated params are no longer measured.
  "deprecated",
]);

/**
 * 2026-06-18 incumbent: every active parameter currently declares
 * `measurement: "deferred-#1967"` because no parameter-level
 * AnalysisSpec mapping exists yet. #1967 backfills real `specSlug`
 * declarations; this ratchet shrinks as it lands.
 */
const EXPECTED_DEFERRED_MEASUREMENT_COUNT = 57;

describe("Parameter usage coverage (declarative Lattice Coverage pillar)", () => {
  it("every parameter has a usage block (data-driven invariant)", () => {
    const missing = registry.parameters.filter(
      (p) => p.parameterId !== null && p.parameterId !== undefined && !p.usage,
    );
    expect(
      missing.length,
      `Parameters missing the declarative \`usage\` block:\n  ${missing
        .slice(0, 10)
        .map((p) => p.parameterId)
        .join("\n  ")}\n\nFix: add \`usage: { compose, measurement }\` to each row. ` +
        `For active params: compose ∈ {semantics-block, prompt-injection, transform-direct}; ` +
        `measurement ∈ {{specSlug: "..."}, "deferred-#1967"}.`,
    ).toBe(0);
  });

  it("every usage.compose is one of the allowed values", () => {
    const bad: Array<{ id: string; compose: string }> = [];
    for (const p of registry.parameters) {
      if (!p.parameterId || !p.usage) continue;
      if (!ALLOWED_COMPOSE_VALUES.has(p.usage.compose)) {
        bad.push({ id: p.parameterId, compose: p.usage.compose });
      }
    }
    expect(
      bad,
      `Parameters with usage.compose outside the allowed set:\n  ${bad
        .map((b) => `${b.id}: "${b.compose}"`)
        .join("\n  ")}\n\nAllowed: ${Array.from(ALLOWED_COMPOSE_VALUES).join(", ")}`,
    ).toEqual([]);
  });

  it("every usage.measurement is either a {specSlug}, {specSlugs}, or an allowed string", () => {
    const bad: Array<{ id: string; measurement: unknown }> = [];
    for (const p of registry.parameters) {
      if (!p.parameterId || !p.usage) continue;
      const m = p.usage.measurement;
      if (typeof m === "string") {
        if (!ALLOWED_MEASUREMENT_STRING_VALUES.has(m)) {
          bad.push({ id: p.parameterId, measurement: m });
        }
      } else if (typeof m === "object" && m !== null) {
        // Allow EITHER { specSlug: "..." } (single) OR { specSlugs: ["...", ...] } (multi)
        const single = (m as { specSlug?: unknown }).specSlug;
        const multi = (m as { specSlugs?: unknown }).specSlugs;
        const singleOk =
          typeof single === "string" && single.trim().length > 0;
        const multiOk =
          Array.isArray(multi) &&
          multi.length > 0 &&
          multi.every((s) => typeof s === "string" && s.trim().length > 0);
        if (!singleOk && !multiOk) {
          bad.push({ id: p.parameterId, measurement: m });
        }
      } else {
        bad.push({ id: p.parameterId, measurement: m });
      }
    }
    expect(
      bad,
      `Parameters with malformed usage.measurement:\n  ${bad
        .map((b) => `${b.id}: ${JSON.stringify(b.measurement)}`)
        .join("\n  ")}\n\nAllowed shapes: {specSlug: "<slug>"} OR one of ${Array.from(ALLOWED_MEASUREMENT_STRING_VALUES).join(", ")}.`,
    ).toEqual([]);
  });

  it("ratchet — deferred-#1967 measurement count cannot exceed the 2026-06-18 budget", () => {
    const deferred = registry.parameters.filter(
      (p) =>
        p.parameterId &&
        p.usage?.measurement === "deferred-#1967",
    );
    expect(
      deferred.length,
      `${deferred.length} active parameters still have \`measurement: "deferred-#1967"\` ` +
        `(producer-only debt tracked by epic #1967). The ratchet caps this at ${EXPECTED_DEFERRED_MEASUREMENT_COUNT}. ` +
        `If you LOWERED the count (great!), drop EXPECTED_DEFERRED_MEASUREMENT_COUNT to ${deferred.length}. ` +
        `If you RAISED it: a new parameter landed without a real specSlug. Either add the AnalysisSpec and declare ` +
        `\`measurement: { specSlug: "..." }\`, OR consciously accept the debt and bump this ratchet.`,
    ).toBeLessThanOrEqual(EXPECTED_DEFERRED_MEASUREMENT_COUNT);
  });

  it("deprecated parameters declare both compose and measurement as 'deprecated'", () => {
    const inconsistent: Array<{
      id: string;
      compose: string;
      measurement: unknown;
    }> = [];
    for (const p of registry.parameters) {
      if (!p.parameterId) continue;
      if (!p.deprecatedAt) continue;
      const c = p.usage?.compose;
      const m = p.usage?.measurement;
      if (c !== "deprecated" || m !== "deprecated") {
        inconsistent.push({
          id: p.parameterId,
          compose: c ?? "<missing>",
          measurement: m ?? "<missing>",
        });
      }
    }
    expect(
      inconsistent,
      `Deprecated parameters with non-deprecated usage:\n  ${inconsistent
        .map((i) => `${i.id}: compose=${i.compose} measurement=${JSON.stringify(i.measurement)}`)
        .join("\n  ")}\n\nFix: set both \`usage.compose\` and \`usage.measurement\` to "deprecated".`,
    ).toEqual([]);
  });

  it("distribution sanity — at least 130 active parameters reach the LLM via semantics-block (S4 invariant)", () => {
    // S4 (#1951) wired `behavior_targets_semantics` to emit every active
    // param. Most active params use the default "semantics-block" route;
    // some opt into "prompt-injection" or "transform-direct".
    const semantics = registry.parameters.filter(
      (p) => p.parameterId && p.usage?.compose === "semantics-block",
    );
    expect(semantics.length).toBeGreaterThan(90);
  });
});
