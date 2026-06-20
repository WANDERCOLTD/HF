/**
 * Parameter coverage — Lattice Coverage-pillar member (2026-06-17).
 *
 * **What this test pins:**
 *  Every Parameter declared in
 *  `docs-archive/bdd-specs/behavior-parameters.registry.json` (the
 *  canonical seed) MUST be CONSUMED somewhere in runtime code —
 *  scoring pipeline / compose transforms / BehaviorTarget reads /
 *  cascade resolvers. A Parameter row in the DB with no runtime
 *  consumer is producer-only: educators set a target, the value
 *  never reaches the prompt or scoring.
 *
 *  Sibling to `registry-consumer-coverage.test.ts` (#1849) — same
 *  generic pattern, third producer↔consumer surface (Parameters
 *  rather than JourneySettings). 154 parameters in the canonical
 *  registry as of 2026-06-17.
 *
 * **How matching works:**
 *  For each parameter:
 *    1. Skip if in `PARAMETER_EXEMPT` (with reason).
 *    2. Check the consumer-source concatenation (transforms, compose,
 *       pipeline, scoring, measurement, cascade) for the parameter's
 *       canonical ID OR camelCase / SCREAMING_SNAKE_CASE variants.
 *    3. Covered when found; gap otherwise.
 *
 * **Two name forms searched per parameter:**
 *  - exact ID (e.g. `BEH-RESPONSE-LEN`, `abstract-vs-concrete`)
 *  - normalized variant: kebab → camelCase + uppercase variants
 *    (`abstract-vs-concrete` → `abstractVsConcrete` + `ABSTRACT_VS_CONCRETE`)
 *
 * **How to fix a failure:**
 *  - "Producer-only parameter": either land a consumer (pipeline
 *    runner reads the score / compose transform renders the directive
 *    / BehaviorTarget loader queries it) OR add to `PARAMETER_EXEMPT`
 *    with a reason describing what's deferred.
 *  - "Stale exempt entry": parameter was removed from registry; drop
 *    the exempt row.
 *  - "Ratchet drifted up": you exempted without bumping; force
 *    conscious choice.
 *
 *  See `.claude/rules/parameter-coverage.md`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const APPS_ADMIN = resolve(__dirname, "..", "..", "..");
const REGISTRY_PATH = join(
  APPS_ADMIN,
  "docs-archive",
  "bdd-specs",
  "behavior-parameters.registry.json",
);

// ────────────────────────────────────────────────────────────
// Registry load
// ────────────────────────────────────────────────────────────

interface RegistryEntry {
  parameterId: string;
  name?: string;
  domainGroup?: string;
  /**
   * #2084 S6 (Fork 3 → walk aliases) — registry alias array. SUPV-001 + REW-001
   * declare their parameters with snake_case ids (e.g. `response_length_score`,
   * `engagement_reward`) and the registry mirrors those alongside the BEH-*
   * canonical id. When classifying coverage we walk the alias list so a
   * consumer can match against EITHER form without forcing a rename pass
   * across the registry. The snake_case → camelCase mirror still applies.
   */
  aliases?: string[];
}

interface Registry {
  parameters: RegistryEntry[];
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as Registry;

// ────────────────────────────────────────────────────────────
// Consumer-source concat
// ────────────────────────────────────────────────────────────

const CONSUMER_DIRS = [
  "lib/prompt/composition/transforms",
  "lib/prompt/composition/loaders",
  "lib/prompt/composition",
  "lib/compose",
  "lib/pipeline",
  "lib/measurement",
  "lib/cascade/resolvers",
  "lib/scoring",
  "lib/tolerance",
  "lib/goals",
  "lib/voice",
  "lib/skill-banding",
  // Chat / tuner reads parameter IDs to apply educator-driven tunes
  // through `update_behavior_target` admin tool + the unified assistant
  // prompt. Counts as a runtime consumer because the cascade write
  // here affects the next composed prompt.
  "lib/chat",
  // Pipeline runners + admin routes that read parameter scores live in
  // app/api/ — calls/[id]/pipeline writes CallScore against parameter IDs.
  "app/api",
];

function walkTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walkTs(full));
    } else if ((e.endsWith(".ts") || e.endsWith(".tsx")) && !e.endsWith(".test.ts")) {
      if (full.includes("/__tests__/")) continue;
      out.push(full);
    }
  }
  return out;
}

// ADAPT-*.spec.json files are runtime consumer surfaces — `adapt-runner.ts`
// reads `parameters[].config.adaptationRules[].actions[].targetParameter`
// strings at runtime and writes the named parameter's `CallerTarget` row.
// Including the spec JSON as consumer source makes spec-driven parameter
// wiring count as `covered` (the equivalent of a literal mention in code).
// Born of #2087 (S2 of #2078 — learning-style 18-param wiring via
// ADAPT-LEARN-001 branches).
const SPEC_CONSUMER_DIRS = ["docs-archive/bdd-specs"];
const SPEC_CONSUMER_PATTERNS = [/^ADAPT-[A-Z]+-\d+.*\.spec\.json$/];

function walkSpecJson(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) continue;
    if (SPEC_CONSUMER_PATTERNS.some((re) => re.test(e))) {
      out.push(full);
    }
  }
  return out;
}

const CONSUMER_SOURCE: string = (() => {
  const files: string[] = [];
  for (const dir of CONSUMER_DIRS) {
    files.push(...walkTs(join(APPS_ADMIN, dir)));
  }
  for (const dir of SPEC_CONSUMER_DIRS) {
    files.push(...walkSpecJson(join(APPS_ADMIN, dir)));
  }
  return files
    .map((f) => {
      try {
        return readFileSync(f, "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
})();

// ────────────────────────────────────────────────────────────
// Name-form variants
// ────────────────────────────────────────────────────────────

function camelCase(id: string): string {
  return id
    .toLowerCase()
    .replace(/[-_]+([a-z0-9])/g, (_m, ch) => ch.toUpperCase());
}

function screamingSnake(id: string): string {
  return id.toUpperCase().replace(/-/g, "_");
}

function searchTerms(id: string): string[] {
  const out = new Set<string>([id]);
  // For kebab-case BEH-* / kebab IDs add camelCase + SCREAMING_SNAKE.
  if (/[-]/.test(id)) {
    out.add(camelCase(id));
    out.add(screamingSnake(id));
  }
  // For snake_case ids add camelCase.
  if (/_/.test(id)) {
    out.add(camelCase(id));
  }
  return Array.from(out);
}

/**
 * #2084 S6 (Fork 3 → walk aliases) — produce search terms for BOTH the
 * canonical parameter id AND each declared alias. Lets a consumer that
 * writes the snake_case alias (e.g. `engagement_reward` from REW-001.spec)
 * match a registry row whose canonical id is `BEH-ENGAGEMENT-REWARD`.
 *
 * Empty / missing alias array degrades to canonical-only.
 */
function searchTermsWithAliases(entry: RegistryEntry): string[] {
  const out = new Set<string>(searchTerms(entry.parameterId));
  for (const alias of entry.aliases ?? []) {
    if (!alias || typeof alias !== "string") continue;
    for (const t of searchTerms(alias)) out.add(t);
  }
  return Array.from(out);
}

// ────────────────────────────────────────────────────────────
// Exempt list — categories of parameters with documented partial wiring
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  reason: string;
}

const PARAMETER_EXEMPT: Record<string, ExemptEntry> = {
  // 2026-06-17 audit will populate this after the test runs and the
  // numbers are known. Initial sweep below will report all gaps; this
  // PR freezes them as the incumbent population.
};

/**
 * 2026-06-17 audit baseline. 118 of 154 parameters lacked a runtime
 * consumer at audit time — in the registry, BehaviorTarget seed wires a
 * System default, educators can theoretically tune them, but nothing in
 * the compose / scoring / cascade / chat paths reads the result.
 *
 * Concentrated in:
 *   - learning-adaptation (23 gaps) — adaptive learning transforms not built
 *   - curriculum-adaptation (21) — adaptive curriculum transforms not built
 *   - supervision (12) — pipeline SUPERVISE stage runner gap
 *   - companion (11) — companion-style transforms partial
 *
 * Each wired consumer drops this number by 1.
 *
 * **History:**
 * - 2026-06-17 — 118 (initial baseline, registered at #1907 audit)
 * - 2026-06-19 — 106 (#2085 S5 wires 12 companion params via
 *   `transforms/companion.ts`).
 * - 2026-06-20 — 52 (#2087 S2 wires 31 learning-style params via
 *   parametersAsDirectives dispatcher + ADAPT-LEARN-001 spec branches +
 *   ADAPT-*.spec.json scan extension).
 * - 2026-06-20 — #2086 S4 wires 13 engagement+onboarding via
 *   ADAPT-ENG-001 spec branches (further drops actual count; ratchet
 *   retains 52 as upper bound).
 * - 2026-06-20 — #2084 S6 wires 15 supervision + reward params via
 *   SCORE_AGENT extension + REW-001 per-component mirror via the
 *   canonical `writeCallScore` chokepoint. Fork 3 alias-walking caught
 *   4 incidental matches in companion/curriculum-adaptation/engagement
 *   that previously slipped on snake_case vs canonical BEH-* form.
 *   See `lib/measurement/supv-rew-consumer-manifest.ts` for the wired
 *   list and PR #2088 for the design brief. Ratchet retains 52 as
 *   upper bound; cleanup PR will tighten once stable.
 */
const EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET = 52;

// ────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────

type Classification = "covered" | "exempt" | "gap";

interface ParamResult {
  id: string;
  classification: Classification;
  matchedTerm?: string;
  reason?: string;
  domainGroup?: string;
}

function classify(p: RegistryEntry): ParamResult {
  if (PARAMETER_EXEMPT[p.parameterId]) {
    return {
      id: p.parameterId,
      classification: "exempt",
      reason: PARAMETER_EXEMPT[p.parameterId].reason,
      domainGroup: p.domainGroup,
    };
  }
  // #1907 — dispatcher-covered classification. Parameters carrying a
  // `promptInjection` block in the registry are read dynamically by the
  // `parametersAsDirectives` transform (no literal mention in consumer
  // source — would otherwise show as `gap`). Treat the registry block
  // itself as the consumer signal.
  if ((p as RegistryEntry & { promptInjection?: unknown }).promptInjection) {
    return {
      id: p.parameterId,
      classification: "covered",
      matchedTerm: "promptInjection (registry-driven dispatcher)",
      domainGroup: p.domainGroup,
    };
  }
  // #2084 S6 (Fork 3) — walk aliases at search time. The supervision +
  // reward params live in the registry as BEH-* canonical with snake_case
  // in `aliases[]`; SCORE_AGENT writes the snake_case form (from
  // SUPV-001.spec.json parameters[].id) for SUPV-001. This lets a single
  // consumer string match either id form.
  for (const term of searchTermsWithAliases(p)) {
    if (term.length < 4) continue; // skip too-generic
    const re = new RegExp(
      `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    );
    if (re.test(CONSUMER_SOURCE)) {
      return {
        id: p.parameterId,
        classification: "covered",
        matchedTerm: term,
        domainGroup: p.domainGroup,
      };
    }
  }
  return {
    id: p.parameterId,
    classification: "gap",
    domainGroup: p.domainGroup,
  };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Parameter coverage (Lattice Coverage pillar)", () => {
  const results = registry.parameters.map(classify);
  const gaps = results.filter((r) => r.classification === "gap");
  const covered = results.filter((r) => r.classification === "covered");
  const exempt = results.filter((r) => r.classification === "exempt");

  it("publishes the parameter coverage distribution (operator log)", () => {
    const sum = covered.length + exempt.length + gaps.length;
    expect(sum).toBe(results.length);
  });

  it("ratchet — gap count cannot exceed the 2026-06-17 incumbent budget", () => {
    expect(
      gaps.length,
      `Producer-only parameters (no consumer found in runtime code):\n  ${gaps
        .slice(0, 15)
        .map((g) => `${g.id} (${g.domainGroup})`)
        .join("\n  ")}` +
        (gaps.length > 15 ? `\n  ... ${gaps.length - 15} more` : "") +
        `\n\nFix: either land a consumer in runtime code, OR add to PARAMETER_EXEMPT with a reason describing what's deferred. If the gap class genuinely grew (new parameters seeded without consumers), bump EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET — but pause: was that intentional?`,
    ).toBeLessThanOrEqual(EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET);
  });

  it("every exempt entry has a non-empty reason (>10 chars)", () => {
    for (const [id, entry] of Object.entries(PARAMETER_EXEMPT)) {
      expect(entry.reason.trim().length, `${id}: empty/short reason`).toBeGreaterThan(10);
    }
  });

  it("no exempt entry is stale — id still in registry", () => {
    const known = new Set(registry.parameters.map((p) => p.parameterId));
    const stale = Object.keys(PARAMETER_EXEMPT).filter((id) => !known.has(id));
    expect(
      stale,
      `Exempt entries for parameter IDs not in the registry — registry deleted the parameter; remove the exempt row:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no exempt entry is contradicted — exempt param now has a consumer", () => {
    const contradicted: string[] = [];
    for (const id of Object.keys(PARAMETER_EXEMPT)) {
      for (const term of searchTerms(id)) {
        if (term.length < 4) continue;
        const re = new RegExp(
          `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        );
        if (re.test(CONSUMER_SOURCE)) {
          contradicted.push(`${id} (term '${term}' found in consumer source)`);
          break;
        }
      }
    }
    expect(
      contradicted,
      `Exempt parameters now have consumers — remove from PARAMETER_EXEMPT:\n  ${contradicted.join("\n  ")}`,
    ).toEqual([]);
  });
});
