/**
 * config.specs.* presence coverage — Data Presence Coverage sub-pillar
 * (epic #2168, story #2311).
 *
 * Every `config.specs.*` getter in `lib/config.ts` is a runtime soft FK:
 * the consumer reads `prisma.analysisSpec.findFirst({where: { slug: ... }})`
 * at runtime and silently degrades when the row is missing. The Lattice
 * has no build-time gate today — PR #2307 surfaced THREE stacked silent
 * failures on TOOLS-001 (spec file rejected → row never seeded → resolver
 * mismatch → log-only fallback).
 *
 * This gate enumerates every `config.specs.*` default and asserts:
 *   1. A `<DEFAULT>*.spec.json` file exists under docs-archive/bdd-specs/.
 *   2. The spec file parses cleanly via `parseJsonSpec` (catches the
 *      "Missing required field: parameters" silent-rejection class —
 *      AIKNOW-001, ERRMON-001, IELTS-P3-FOCUS-001, METER-001 incumbent
 *      population).
 *
 * Ratchet on incumbent failures via `CONFIG_SPECS_EXEMPT` with a >20-char
 * `reason`. New getters cannot ship an exempt without conscious bump.
 *
 * Runtime sibling (separate follow-on per #2311): extend
 * `scripts/check-fk-consistency.ts` with a live-DB query that asserts
 * `spec-<id-lowercase>` exists in `AnalysisSpec` with `isActive=true`.
 *
 * Rule: `.claude/rules/config-specs-presence-coverage.md`.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseJsonSpec } from "@/lib/bdd/ai-parser";

const REPO_ADMIN = resolve(__dirname, "..", "..", "..");
const SPECS_DIR = join(REPO_ADMIN, "docs-archive", "bdd-specs");
const CONFIG_PATH = join(REPO_ADMIN, "lib", "config.ts");

interface ExemptEntry {
  /** Why the spec is allowed to fail today. >20-char justification required. */
  reason: string;
}

/**
 * Incumbent silent-rejection population at the time this gate was filed.
 * Each entry MUST cite #2311 and the structural cause. Removing an entry
 * is the expected drift direction (fix the spec → drop the row).
 */
const CONFIG_SPECS_EXEMPT: Record<string, ExemptEntry> = {
  // 2026-06-24 incumbent failures surfaced by this gate's first run.
  // Each is a config.specs.* getter pointing at a spec file that
  // parseJsonSpec rejects — same silent-rejection class as #2307's
  // TOOLS-001. Fixing each is a separate PR (data, not code: add the
  // missing required field to the spec file). See #2311 for the audit
  // trail. Removing an entry is the expected drift direction.
  "TOOLS-001": {
    reason:
      "Missing parameters[] field — fixed by PR #2307 (not yet merged into main). Drop this entry once #2307 merges; the spec then parses cleanly.",
  },
  "CONTENT-SOURCE-SETUP-001": {
    reason:
      "Missing story.{asA,iWant,soThat} — setup-wizard spec lacks the BDD story block parseJsonSpec demands. Fix by adding placeholder story or relaxing parseJsonSpec for SETUP-class specs. Tracked in #2311.",
  },
  "COURSE-SETUP-001": {
    reason:
      "Missing story.{asA,iWant,soThat} — same setup-wizard structural shape as CONTENT-SOURCE-SETUP-001. Tracked in #2311.",
  },
  "COMMUNITY-SETUP-001": {
    reason:
      "Missing story.{asA,iWant,soThat} — same setup-wizard structural shape as CONTENT-SOURCE-SETUP-001. Tracked in #2311.",
  },
  // Missing-file class — getter defaults point at spec filenames that
  // don't exist. Each silently no-ops at runtime. Authoring the spec
  // file is a separate follow-on per #2311.
  "INSTITUTION-SETUP-001": {
    reason:
      "No spec file at docs-archive/bdd-specs/INSTITUTION-SETUP-001*.spec.json — getter at lib/config.ts:598 points at a non-existent spec. Author the spec or repurpose the default. Tracked in #2311.",
  },
  "DEMONSTRATE-FLOW-001": {
    reason:
      "No spec file at docs-archive/bdd-specs/DEMONSTRATE-FLOW-001*.spec.json — getter at lib/config.ts:634 points at a non-existent spec. Tracked in #2311.",
  },
  "TEACH-FLOW-001": {
    reason:
      "No spec file at docs-archive/bdd-specs/TEACH-FLOW-001*.spec.json — getter at lib/config.ts:643 points at a non-existent spec. Tracked in #2311.",
  },
};

const EXPECTED_EXEMPT_COUNT = 7;

// ────────────────────────────────────────────────────────────
// Enumerate every `optional("XXX_SPEC_SLUG", "<default>")` in lib/config.ts
// ────────────────────────────────────────────────────────────

interface SpecGetter {
  envVar: string;
  defaultSlug: string;
}

function enumerateConfigSpecsGetters(): SpecGetter[] {
  const source = readFileSync(CONFIG_PATH, "utf-8");
  const re = /optional\("([A-Z_][A-Z0-9_]*_SPEC_SLUG)",\s*"([^"]+)"\)/g;
  const getters: SpecGetter[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    getters.push({ envVar: m[1], defaultSlug: m[2] });
  }
  return getters;
}

/**
 * Resolve a `config.specs.*` default slug to its source spec file.
 * Convention: file is `<id>-<descriptive>.spec.json` where `<id>` is
 * either the bare default (TOOLS-001) or the default with `spec-` prefix
 * stripped (spec-comp-001 → COMP-001).
 */
function findSpecFileForSlug(defaultSlug: string): string | null {
  const stripped = defaultSlug.replace(/^spec-/i, "").toUpperCase();
  const files = readdirSync(SPECS_DIR);
  // Exact-prefix match first: "<ID>-…" or "<ID>.spec.json"
  const exact = files.find(
    (f) =>
      f.toUpperCase().startsWith(`${stripped}-`) ||
      f.toUpperCase() === `${stripped}.SPEC.JSON`,
  );
  return exact ?? null;
}

type Classification =
  | { kind: "ok"; file: string }
  | { kind: "missing-file"; defaultSlug: string }
  | { kind: "parse-rejected"; file: string; errors: string[] }
  | { kind: "exempt"; reason: string };

function classify(getter: SpecGetter): Classification {
  const exempt = CONFIG_SPECS_EXEMPT[getter.defaultSlug];
  if (exempt) return { kind: "exempt", reason: exempt.reason };

  const file = findSpecFileForSlug(getter.defaultSlug);
  if (!file) return { kind: "missing-file", defaultSlug: getter.defaultSlug };

  const filePath = join(SPECS_DIR, file);
  const content = readFileSync(filePath, "utf-8");
  const parseResult = parseJsonSpec(content);
  if (!parseResult.success) {
    return { kind: "parse-rejected", file, errors: parseResult.errors };
  }
  return { kind: "ok", file };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("config.specs.* presence coverage (Data Presence sub-pillar)", () => {
  const getters = enumerateConfigSpecsGetters();

  it("enumerates at least 40 config.specs.* getters (sanity)", () => {
    // Sanity check that the regex matched. At time of writing there are
    // 50 getters in lib/config.ts. If this drops below 40 the regex
    // probably stopped matching.
    expect(getters.length).toBeGreaterThanOrEqual(40);
  });

  it("every config.specs.* default has a corresponding spec file", () => {
    const missing = getters
      .map((g) => ({ getter: g, classification: classify(g) }))
      .filter((r) => r.classification.kind === "missing-file");

    if (missing.length > 0) {
      const lines = missing.map(
        (r) =>
          `  • ${r.getter.envVar} (default="${r.getter.defaultSlug}"): no spec file found under docs-archive/bdd-specs/`,
      );
      throw new Error(
        `Config.specs slugs with no matching spec file:\n${lines.join("\n")}\n\n` +
          "Either (a) add the spec file at docs-archive/bdd-specs/<id>-<descriptive>.spec.json, " +
          "(b) update lib/config.ts default to point at an existing spec, or " +
          "(c) add the slug to CONFIG_SPECS_EXEMPT with a >20-char reason.",
      );
    }
  });

  it("every config.specs.* spec file parses successfully via parseJsonSpec", () => {
    const rejected = getters
      .map((g) => ({ getter: g, classification: classify(g) }))
      .filter((r) => r.classification.kind === "parse-rejected") as Array<{
      getter: SpecGetter;
      classification: Extract<Classification, { kind: "parse-rejected" }>;
    }>;

    if (rejected.length > 0) {
      const lines = rejected.map(
        (r) =>
          `  • ${r.getter.envVar} (default="${r.getter.defaultSlug}") in ${r.classification.file}:\n` +
          `      ${r.classification.errors.join("; ")}`,
      );
      throw new Error(
        `Config.specs slugs whose spec file fails parseJsonSpec:\n${lines.join("\n")}\n\n` +
          "These specs will be silently skipped by prisma/seed-from-specs.ts. " +
          "Fix the spec file (most common: add `\"parameters\": []` for SYSTEM/VOICE/OBSERVE specs that have no measurement parameters).",
      );
    }
  });

  it("exempt count matches the ratchet", () => {
    const actualExemptCount = Object.keys(CONFIG_SPECS_EXEMPT).length;
    expect(actualExemptCount).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a >20-char reason citing the structural cause", () => {
    for (const [slug, entry] of Object.entries(CONFIG_SPECS_EXEMPT)) {
      expect(entry.reason.length, `exempt ${slug} reason too short`).toBeGreaterThan(20);
    }
  });

  it("no exempt entry references a slug that no getter declares (stale exempt)", () => {
    const declaredDefaults = new Set(getters.map((g) => g.defaultSlug));
    const stale: string[] = [];
    for (const slug of Object.keys(CONFIG_SPECS_EXEMPT)) {
      if (!declaredDefaults.has(slug)) stale.push(slug);
    }
    expect(stale, `stale CONFIG_SPECS_EXEMPT entries`).toEqual([]);
  });
});
