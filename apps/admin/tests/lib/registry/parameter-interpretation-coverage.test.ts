/**
 * Parameter interpretation coverage (Lattice Coverage-pillar member)
 *
 * Every active (non-deprecated) parameter in the canonical registry
 * MUST carry both `interpretationHigh` and `interpretationLow` of at
 * least 20 chars — OR be flagged `skipInterpretationLengthCheck: true`
 * (the schema escape hatch added in #1951 for params whose
 * interpretation is legitimately short, e.g. binary axis labels).
 *
 * Why this exists
 *
 * Pre-#1951, the composed prompt's behaviour-target instruction emitted
 * `interpretationHigh`/`interpretationLow` only for the top-5 targets
 * (slice cap at `transforms/instructions.ts:234`). The new
 * `behavior_targets_semantics` directive (this PR) carries the full
 * list, so the LLM finally sees the meaning of every tuned parameter.
 * For that to be useful, every parameter MUST have a meaningful
 * interpretation — otherwise the LLM falls back to "balanced approach"
 * placeholder for the 17 params currently missing both.
 *
 * Ratchet
 *
 * `EXPECTED_MISSING_COUNT` starts at the 2026-06-18 incumbent (17 active
 * params lacking interpretations). Pedagogy backfill in S4 drives this
 * to 0; future PRs cannot increase it. Authors adding a new BEHAVIOR
 * parameter MUST land its interpretations in the same PR.
 *
 * Sibling Coverage-pillar tests
 *
 * - `registry-schema-coverage.test.ts` (PlaybookConfig field set)
 * - `registry-consumer-coverage.test.ts` (storagePath → consumer)
 * - `parameter-coverage.test.ts` (parameterId → consumer)
 * - `tier-visibility-coverage.test.ts` (route redactors)
 * - `route-auth-zod-coverage.test.ts` (route auth/Zod)
 *
 * Catalogued in `docs/kb/guard-registry.md` as part of the Coverage
 * pillar.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const REGISTRY_PATH = join(
  process.cwd(),
  "docs-archive/bdd-specs/behavior-parameters.registry.json",
);

const MIN_INTERPRETATION_CHARS = 20;

/**
 * 2026-06-18 incumbent budget. The 17 active params lacking
 * interpretations at S4 birth. Drop by 1 every time an interpretation
 * lands. When this hits 0, replace the ratchet assertion with
 * `gaps.length === 0` (strict mode).
 */
const EXPECTED_MISSING_COUNT = 17;

interface RegistryRow {
  parameterId: string;
  deprecatedAt?: string | null;
  interpretationHigh?: string | null;
  interpretationLow?: string | null;
  skipInterpretationLengthCheck?: boolean;
}

function loadRegistry(): { parameters: RegistryRow[] } {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
}

function classify(p: RegistryRow): "active" | "deprecated" | "exempt" | "missing" {
  if (p.deprecatedAt) return "deprecated";
  if (p.skipInterpretationLengthCheck) return "exempt";
  const high = (p.interpretationHigh ?? "").length;
  const low = (p.interpretationLow ?? "").length;
  if (high < MIN_INTERPRETATION_CHARS || low < MIN_INTERPRETATION_CHARS) {
    return "missing";
  }
  return "active";
}

describe("Parameter interpretation coverage (Lattice Coverage pillar)", () => {
  const { parameters } = loadRegistry();

  it("distribution sanity — non-empty registry, every row classifiable", () => {
    expect(parameters.length).toBeGreaterThan(100);
    const classifications = parameters.map(classify);
    expect(classifications.length).toBe(parameters.length);
  });

  it("ratchet — missing-interpretation count cannot exceed the 2026-06-18 budget", () => {
    const missing = parameters.filter((p) => classify(p) === "missing");
    expect(
      missing.length,
      `Expected at most ${EXPECTED_MISSING_COUNT} active params lacking interpretations; got ${missing.length}. ` +
        `If you LOWERED the count (great!), drop EXPECTED_MISSING_COUNT to ${missing.length}. ` +
        `If you RAISED it: a new BEHAVIOR parameter landed without interpretations. Add them in this PR, ` +
        `OR mark the row \`skipInterpretationLengthCheck: true\` if the interpretation is legitimately short. ` +
        `Missing: ${missing.map((p) => p.parameterId).join(", ")}`,
    ).toBeLessThanOrEqual(EXPECTED_MISSING_COUNT);
  });

  it("exempt parameters still have non-null interpretations", () => {
    // `skipInterpretationLengthCheck: true` relaxes only the 20-char
    // length rule. The interpretation MUST still be non-null and
    // present — otherwise the LLM sees nothing.
    const exemptWithNull = parameters.filter(
      (p) =>
        p.skipInterpretationLengthCheck &&
        !p.deprecatedAt &&
        (!p.interpretationHigh || !p.interpretationLow),
    );
    expect(
      exemptWithNull.length,
      `skipInterpretationLengthCheck=true does NOT permit a null interpretation, only a short one. ` +
        `Offenders: ${exemptWithNull.map((p) => p.parameterId).join(", ")}`,
    ).toBe(0);
  });

  it("no duplicate parameterIds (sanity check on the seed source)", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const p of parameters) {
      if (seen.has(p.parameterId)) dupes.push(p.parameterId);
      seen.add(p.parameterId);
    }
    expect(dupes).toEqual([]);
  });

  it("deprecated params are not counted against the budget", () => {
    // Deprecated rows often lack interpretations because they were
    // deprecated BEFORE the interpretation backfill landed. They MUST
    // not show up in the `missing` bucket.
    const deprecatedInMissing = parameters.filter(
      (p) => p.deprecatedAt && classify(p) === "missing",
    );
    expect(
      deprecatedInMissing.length,
      `classify() should never return "missing" for a deprecated row. ` +
        `Offenders: ${deprecatedInMissing.map((p) => p.parameterId).join(", ")}`,
    ).toBe(0);
  });
});
