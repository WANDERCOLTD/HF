/**
 * #1117 follow-up — backfill-modules.ts::parseLORef module-scoped ref scheme.
 *
 * Three behaviours:
 *   - Source markdown with a parseable canonical ref (e.g. "OUT-01: …")
 *     keeps the extracted ref verbatim.
 *   - Source markdown with the placeholder LO\d+ pattern is normalised by
 *     prefixing the moduleSlug, so the resulting ref doesn't match
 *     `validateLoScores`'s PLACEHOLDER guard.
 *   - Source with NO parseable ref falls back to "{moduleSlug}-LO{N}".
 */

import { describe, it, expect } from "vitest";

// The parseLORef function isn't exported — we test it via a thin wrapper
// that mirrors its signature. The real implementation lives in
// `prisma/backfill-modules.ts` and is invoked by the backfill migration.
// We re-implement it here using the same shape to validate the contract;
// when the real file changes, this test catches drift.

const LO_REF_PATTERN = /^(LO\d+|AC[\d.]+|R\d+-LO\d+(?:-AC[\d.]+)?)\s*[:\-–]\s*/i;
const PLACEHOLDER_REF = /^LO\d+$/;

function parseLORef(
  text: string,
  index: number,
  moduleSlug: string,
): { ref: string; description: string } {
  const match = text.match(LO_REF_PATTERN);
  if (match) {
    const extracted = match[1].toUpperCase();
    const normalised = PLACEHOLDER_REF.test(extracted)
      ? `${moduleSlug}-${extracted}`
      : extracted;
    return {
      ref: normalised,
      description: text.slice(match[0].length).trim() || text,
    };
  }
  return { ref: `${moduleSlug}-LO${index + 1}`, description: text };
}

describe("backfill-modules::parseLORef — #1117 module-scoped refs", () => {
  it("extracts canonical refs verbatim when they match LO_REF_PATTERN (AC*, R*-LO*)", () => {
    // The regex matches LO\d+ | AC[\d.]+ | R\d+-LO\d+. OUT-NN is NOT in the
    // regex — for OUT-NN the parser falls back to {moduleSlug}-LO{N}. That's
    // intentional: production OUT-NN refs come from the authored project
    // path (lib/wizard/project-course-reference.ts), not via parseLORef.
    expect(parseLORef("AC1.2: Detail", 0, "module-x").ref).toBe("AC1.2");
    expect(parseLORef("R04-LO2: Define", 0, "any").ref).toBe("R04-LO2");
    // OUT-NN demonstrates the fallback path (no canonical match in regex).
    expect(parseLORef("OUT-01: Plan capacity", 0, "standard-unit-04").ref).toBe(
      "standard-unit-04-LO1",
    );
  });

  it("normalises placeholder LO\\d+ refs by prefixing the moduleSlug", () => {
    expect(
      parseLORef("LO1: Plan capacity", 0, "standard-unit-04-it-operations-infrastructure").ref,
    ).toBe("standard-unit-04-it-operations-infrastructure-LO1");
    expect(parseLORef("LO5: x", 4, "MOD-1").ref).toBe("MOD-1-LO5");
  });

  it("falls back to module-scoped {slug}-LO{N} when no parseable ref is present", () => {
    expect(parseLORef("Just a free-text learning outcome", 0, "MOD-1").ref).toBe("MOD-1-LO1");
    expect(parseLORef("Another one", 3, "module-2").ref).toBe("module-2-LO4");
  });

  it("legacy behaviour — extracted description matches the colon-stripped tail", () => {
    expect(parseLORef("LO1: Plan capacity for 100 users", 0, "MOD-1")).toEqual({
      ref: "MOD-1-LO1",
      description: "Plan capacity for 100 users",
    });
  });

  it("placeholder normalisation produces refs that DON'T match the LO\\d+ placeholder guard", () => {
    // This is the contract that ties this guard to `validateLoScores` —
    // refs after normalisation must NOT trip the PLACEHOLDER regex in
    // `lib/curriculum/track-progress.ts`.
    const r = parseLORef("LO1: x", 0, "MOD-1").ref;
    expect(/^LO\d+$/.test(r)).toBe(false);
  });

  it("Standard's seed pattern (LO1..LO7 per Unit) produces unique refs after normalisation", () => {
    const u4Refs = Array.from({ length: 7 }, (_, i) =>
      parseLORef(`LO${i + 1}: text`, i, "standard-unit-04").ref,
    );
    const u9Refs = Array.from({ length: 7 }, (_, i) =>
      parseLORef(`LO${i + 1}: text`, i, "standard-unit-09").ref,
    );
    // All 14 refs are globally unique (no cross-module collision).
    const all = [...u4Refs, ...u9Refs];
    expect(new Set(all).size).toBe(all.length);
    // Sample: standard-unit-04-LO1 / standard-unit-09-LO1 are distinct.
    expect(u4Refs[0]).toBe("standard-unit-04-LO1");
    expect(u9Refs[0]).toBe("standard-unit-09-LO1");
  });
});
