/**
 * buildLoMasteryMap — proof tests for #928
 *
 * Verifies the shared CallerAttribute -> loMasteryMap builder used by the
 * three COMPOSE-stage transforms (`modules`, `retrieval-practice`,
 * `progress-narrative`).
 *
 * Acceptance criteria covered:
 *   1. Current-spec rows surface.
 *   2. Sibling-course rows (different curriculum spec) are filtered out.
 *   3. Mixed-spec input returns ONLY current-spec rows.
 *   4. Undefined / empty `currentSpecSlug` returns an empty map (no throw).
 *   5. Non-CURRICULUM scope rows are filtered.
 *   6. `numberValue == null` rows are filtered.
 *   7. Legacy name-form module token under current spec still surfaces
 *      (the #611/#614 grace window is preserved).
 *   8. Two-playbook scenario from the #928 issue body: bleed is blocked.
 */

import { describe, it, expect } from "vitest";
import { buildLoMasteryMap, type LoMasteryAttrLike } from "@/lib/prompt/composition/lo-mastery-map";

const attr = (
  key: string,
  numberValue: number | null,
  scope: string = "CURRICULUM",
): LoMasteryAttrLike => ({ key, scope, numberValue });

describe("buildLoMasteryMap (#928 scoping helper)", () => {
  it("surfaces a row whose key matches the current spec prefix", () => {
    const map = buildLoMasteryMap(
      [attr("curriculum:IELTS:lo_mastery:part1:OUT-01", 0.72)],
      "IELTS",
    );
    expect(map).toEqual({ "part1:OUT-01": 0.72 });
  });

  it("filters out rows whose key prefix names a DIFFERENT curriculum spec", () => {
    const map = buildLoMasteryMap(
      [attr("curriculum:WNF:lo_mastery:part1:OUT-01", 0.95)],
      "IELTS",
    );
    expect(map).toEqual({});
  });

  it("two-playbook bleed scenario (#928 issue body): only current-spec rows survive", () => {
    // Caller enrolled in both IELTS (current) and WNF.
    // The WNF row's score (0.95) outranks the IELTS row's (0.60); pre-#928
    // it would have polluted IELTS's prompt and skewed informationNeed.
    const attrs: LoMasteryAttrLike[] = [
      attr("curriculum:WNF:lo_mastery:module-1:OUT-01", 0.95),   // sibling course
      attr("curriculum:WNF:lo_mastery:module-1:OUT-02", 0.88),   // sibling course
      attr("curriculum:IELTS:lo_mastery:part1:OUT-01", 0.60),    // current course
      attr("curriculum:IELTS:lo_mastery:part1:OUT-02", 0.40),    // current course
    ];
    const map = buildLoMasteryMap(attrs, "IELTS");
    expect(map).toEqual({
      "part1:OUT-01": 0.60,
      "part1:OUT-02": 0.40,
    });
    // Belt-and-braces: nothing from the WNF prefix leaks in.
    expect(Object.keys(map).every((k) => !k.startsWith("module-1"))).toBe(true);
  });

  it("colliding suffix across two specs only keeps the current-spec value", () => {
    // Both specs use `part-1:OUT-01` as suffix shape. Pre-#928 the tolerant
    // matcher would overwrite based on Object.keys insertion order; post-fix
    // only the current-spec value survives.
    const map = buildLoMasteryMap(
      [
        attr("curriculum:OTHER:lo_mastery:part-1:OUT-01", 0.99),
        attr("curriculum:IELTS:lo_mastery:part-1:OUT-01", 0.42),
      ],
      "IELTS",
    );
    expect(map).toEqual({ "part-1:OUT-01": 0.42 });
  });

  it("returns an empty map when currentSpecSlug is undefined (graceful degrade)", () => {
    const map = buildLoMasteryMap(
      [attr("curriculum:IELTS:lo_mastery:part1:OUT-01", 0.7)],
      undefined,
    );
    expect(map).toEqual({});
  });

  it("returns an empty map when currentSpecSlug is the empty string", () => {
    const map = buildLoMasteryMap(
      [attr("curriculum:IELTS:lo_mastery:part1:OUT-01", 0.7)],
      "",
    );
    expect(map).toEqual({});
  });

  it("returns an empty map when callerAttributes is null/undefined", () => {
    expect(buildLoMasteryMap(null, "IELTS")).toEqual({});
    expect(buildLoMasteryMap(undefined, "IELTS")).toEqual({});
    expect(buildLoMasteryMap([], "IELTS")).toEqual({});
  });

  it("filters rows whose scope is not CURRICULUM", () => {
    const map = buildLoMasteryMap(
      [
        attr("curriculum:IELTS:lo_mastery:part1:OUT-01", 0.7, "GLOBAL"),
        attr("curriculum:IELTS:lo_mastery:part1:OUT-02", 0.8, "OTHER"),
        attr("curriculum:IELTS:lo_mastery:part1:OUT-03", 0.9, "CURRICULUM"),
      ],
      "IELTS",
    );
    expect(map).toEqual({ "part1:OUT-03": 0.9 });
  });

  it("filters rows whose numberValue is null", () => {
    const map = buildLoMasteryMap(
      [
        attr("curriculum:IELTS:lo_mastery:part1:OUT-01", null),
        attr("curriculum:IELTS:lo_mastery:part1:OUT-02", 0.5),
      ],
      "IELTS",
    );
    expect(map).toEqual({ "part1:OUT-02": 0.5 });
  });

  it("preserves a legacy NAME-FORM module token under the current spec (#611/#614 grace window)", () => {
    // Pre-#611 writers stamped the module display title instead of the slug.
    // The #928 prefix tightening must NOT drop these — they still share the
    // `curriculum:<spec>:lo_mastery:` prefix.
    const map = buildLoMasteryMap(
      [
        attr("curriculum:IELTS:lo_mastery:Part 1: Familiar Topics:OUT-01", 0.65),
        attr("curriculum:IELTS:lo_mastery:part1:OUT-02", 0.55),
      ],
      "IELTS",
    );
    expect(map).toEqual({
      "Part 1: Familiar Topics:OUT-01": 0.65,
      "part1:OUT-02": 0.55,
    });
  });

  it("ignores rows whose key does not contain :lo_mastery: at all", () => {
    const map = buildLoMasteryMap(
      [
        attr("curriculum:IELTS:mastery_summary:something", 0.9),
        attr("curriculum:IELTS:tp_progress:OUT-01", 0.5),
        attr("recent:lo_mastery:not-curriculum-scoped", 0.7),
        attr("curriculum:IELTS:lo_mastery:part1:OUT-01", 0.42),
      ],
      "IELTS",
    );
    expect(map).toEqual({ "part1:OUT-01": 0.42 });
  });

  it("does NOT prefix-leak when one spec slug is the prefix of another (e.g. 'IELTS' vs 'IELTS-WRITING')", () => {
    // Without an explicit `:` boundary the prefix would alias. The helper
    // composes the full `curriculum:<slug>:lo_mastery:` prefix so this is
    // safe — but explicitly proving it here pins the contract.
    const attrs: LoMasteryAttrLike[] = [
      attr("curriculum:IELTS:lo_mastery:part1:OUT-01", 0.5),
      attr("curriculum:IELTS-WRITING:lo_mastery:essay-1:OUT-05", 0.9),
    ];
    expect(buildLoMasteryMap(attrs, "IELTS")).toEqual({ "part1:OUT-01": 0.5 });
    expect(buildLoMasteryMap(attrs, "IELTS-WRITING")).toEqual({ "essay-1:OUT-05": 0.9 });
  });

  it("drops rows whose suffix is empty (defensive against malformed keys)", () => {
    const map = buildLoMasteryMap(
      [
        attr("curriculum:IELTS:lo_mastery:", 0.7),
        attr("curriculum:IELTS:lo_mastery:part1:OUT-01", 0.42),
      ],
      "IELTS",
    );
    expect(map).toEqual({ "part1:OUT-01": 0.42 });
  });
});
