/**
 * BDD-typed-unions Coverage — #2162 (Lattice Coverage-pillar).
 *
 * **What this test pins:**
 *  Three BDD-defined typed unions in `lib/types/json-fields.ts` —
 *  `CueCardType` / `StallType` / `ScoreReadoutMode` — each get a
 *  three-axis consumer matrix (teaching / adminUI / learnerUI) just like
 *  the sibling `AuthoredModuleMode` Coverage gate at
 *  `tests/lib/sim-chat/mode-ui-coverage.test.ts` (PR #2144). For each
 *  union value × axis cell, the test classifies one of:
 *    - `covered` — a consumer in the axis's source dirs branches on the
 *      literal (e.g. `=== "personal"`, `=== "i-dont-know"`).
 *    - `exempt` — listed in `UNION_AXIS_EXEMPT` with a >20-char reason.
 *      Used for values the BDD spec declares but whose consumer is
 *      intentionally deferred (no UI today; wiring pending follow-on).
 *    - `gap` — neither. Fails the test once consumers ship beyond the
 *      ratchet.
 *
 *  Catches the producer-only failure mode where a BDD-declared union
 *  ships only as a type (or as untyped freeform strings) and no consumer
 *  reads it. The 2026-06-21 big-matrix audit (PR #2144 conversation)
 *  catalogued these three as the remaining BDD-defined unions without
 *  typed declarations OR Coverage gates; this gate closes the matrix
 *  side.
 *
 * **Why bundled into one test file:**
 *  Same generic enumerate→classify→ratchet pattern across three small
 *  unions, all sourced from the same BDD doc family (IELTS US-P2-01 /
 *  US-P3-02b / course-ref v2.3 + HF-IELTS-Pre-Voice-Testing-Checklist
 *  Unit 5). One file is easier to maintain than three near-identical
 *  ones; the paired rule files in `.claude/rules/` document each union
 *  individually.
 *
 * **Source-of-truth sanity:**
 *  Three `*_VALUES` const tuples in `lib/types/json-fields.ts` provide
 *  runtime enumeration. The test asserts the test-local copies match the
 *  source-text union exactly — a refactor adding a new value forces a
 *  matrix update.
 *
 * **How to fix a failure:**
 *  - "Cell X.Y is a gap":
 *      Best — wire the consumer (compose transform branch, admin badge,
 *      learner UI variant).
 *      Acceptable — add to `UNION_AXIS_EXEMPT` with a >20-char reason
 *      describing the deferral, bump `EXPECTED_EXEMPT_COUNT`.
 *  - "Gap count drifted":
 *      You wired a consumer + need to drop `EXPECTED_GAP_COUNT`, OR you
 *      added a new value without wiring — pause + wire.
 *  - "Exempt count drifted":
 *      You added/removed an exempt entry; conscious decision required.
 *  - "Stale exempt entry":
 *      The cell now has a real consumer — remove from exempt.
 *  - "Test matrix diverged from source":
 *      The source union changed — sync `*_VALUES` arrays in this file.
 *
 *  See `.claude/rules/bdd-typed-unions-coverage.md` for the durable rule.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ────────────────────────────────────────────────────────────
// Canonical union values — verified against the source type
// unions at test runtime so a new union value forces a matrix
// update.
// ────────────────────────────────────────────────────────────

const CUE_CARD_TYPE_VALUES = ["personal", "abstract"] as const;
const STALL_TYPE_VALUES = [
  "i-dont-know",
  "opinion-gap",
  "abstraction-freeze",
  "vocabulary-search",
  "blank-out",
] as const;
const SCORE_READOUT_MODE_VALUES = [
  "on-screen",
  "end-of-module-on-screen",
  "aloud-with-indicative-qualifier",
] as const;

type CueCardType = (typeof CUE_CARD_TYPE_VALUES)[number];
type StallType = (typeof STALL_TYPE_VALUES)[number];
type ScoreReadoutMode = (typeof SCORE_READOUT_MODE_VALUES)[number];

type UnionName = "CueCardType" | "StallType" | "ScoreReadoutMode";

const REPO_ADMIN = resolve(__dirname, "..", "..", "..");
const TYPE_SOURCE_PATH = join(REPO_ADMIN, "lib", "types", "json-fields.ts");

// ────────────────────────────────────────────────────────────
// Three axes the matrix pins. Same shape as mode-ui-coverage.
// ────────────────────────────────────────────────────────────

type Axis = "teaching" | "adminUI" | "learnerUI";
const AXES: readonly Axis[] = ["teaching", "adminUI", "learnerUI"] as const;

const AXIS_DIRS: Record<Axis, string[]> = {
  teaching: [
    "lib/prompt/composition/transforms",
    "lib/prompt/composition/loaders",
    "lib/prompt/composition",
    "lib/curriculum",
    "lib/voice",
  ],
  adminUI: [
    "app/x",
    "components/modules-tab",
    "components/journey-tab",
    // #2185 S6 — Content tab CueCardRowEditor lives here and is the
    // CueCardType.adminUI consumer (branches `=== "personal"` /
    // `=== "abstract"` in helperForType).
    "components/content-tab",
  ],
  learnerUI: [
    "components/sim",
    "app/x/student",
    "hooks",
    "../foh/app",
    "../foh/components",
  ],
};

// ────────────────────────────────────────────────────────────
// Exempt list — every (union, value, axis) cell that intentionally
// has no consumer (per Lattice "operator-friendly producer-only debt").
// Required: one-line reason >20 chars.
//
// Initial baseline: all 30 cells are deferred — these unions ship as
// type declarations only (this PR — #2162); the consumer wiring is the
// follow-on. Each entry says WHY the consumer is deferred so the
// follow-on PR knows what to wire.
// ────────────────────────────────────────────────────────────

type CellKey = `${UnionName}.${string}.${Axis}`;

interface ExemptEntry {
  reason: string;
}

const UNION_AXIS_EXEMPT: Partial<Record<CellKey, ExemptEntry>> = {
  // ── CueCardType — Part 2 prep-phase prompt scaffold (BDD US-P2-01)
  // Consumer surface: lib/prompt/composition/transforms/instructions.ts
  // (resolveModuleCueCard) reads cueCardPool entries but does not
  // currently branch on a per-card `type` field. The cueCardPool YAML
  // shape ({topic, bullets}) has no `type` discriminator today — a
  // follow-on PR adds the discriminator + the type-driven prep prompt.
  "CueCardType.personal.teaching": {
    reason:
      "BDD-declared union (US-P2-01) — Part 2 prep-phase prompt scaffold consumer is the follow-on PR; cueCardPool entries currently carry no type discriminator.",
  },
  // CueCardType.personal.adminUI — wired by S6 of #2185
  // (components/content-tab/CueCardRowEditor.tsx): the row editor's
  // `<select>` option set + `=== "personal"` change handler ARE the
  // admin-UI consumer; this exempt entry was dropped to flip the cell
  // from `exempt` to `covered`.
  "CueCardType.personal.learnerUI": {
    reason:
      "the cue card TEXT is learner-facing; the TYPE LABEL is internal — no learner UI branch needed by design.",
  },
  "CueCardType.abstract.teaching": {
    reason:
      "BDD-declared union (US-P2-01) — Part 2 prep-phase prompt scaffold consumer is the follow-on PR; cueCardPool entries currently carry no type discriminator.",
  },
  // CueCardType.abstract.adminUI — wired by S6 of #2185
  // (components/content-tab/CueCardRowEditor.tsx): same `<select>` option
  // set + `=== "abstract"` change handler.
  "CueCardType.abstract.learnerUI": {
    reason:
      "the cue card TEXT is learner-facing; the TYPE LABEL is internal — no learner UI branch needed by design.",
  },

  // ── StallType — Part 3 stall-scaffold trigger (BDD US-P3-02b)
  // Consumer surface: hooks/use-stall-detector.ts currently takes a
  // flat `pool: string[]` — no per-stall-type tag. Source 7 in the
  // IELTS course-ref v2.3 tags each scaffold by stall-shape; the
  // follow-on PR types the pool entries as
  // Array<{ tag: StallType; text: string }> and the detector branches.
  "StallType.i-dont-know.teaching": {
    reason:
      "BDD-declared union (US-P3-02b) — Part 3 stall-scaffold consumer is the client-side detector; the typed pool shape is the follow-on PR.",
  },
  "StallType.i-dont-know.adminUI": {
    reason:
      "no per-stall-tag display in admin Modules tab today — added when scaffoldPool entries gain the tag discriminator (follow-on PR).",
  },
  "StallType.i-dont-know.learnerUI": {
    reason:
      "the scaffold TEXT is learner-facing; the TAG NAME is internal-only per Lattice learner-UI-leak coverage.",
  },
  "StallType.opinion-gap.teaching": {
    reason:
      "BDD-declared union (US-P3-02b) — Part 3 stall-scaffold consumer is the client-side detector; the typed pool shape is the follow-on PR.",
  },
  "StallType.opinion-gap.adminUI": {
    reason:
      "no per-stall-tag display in admin Modules tab today — added when scaffoldPool entries gain the tag discriminator (follow-on PR).",
  },
  "StallType.opinion-gap.learnerUI": {
    reason:
      "the scaffold TEXT is learner-facing; the TAG NAME is internal-only per Lattice learner-UI-leak coverage.",
  },
  "StallType.abstraction-freeze.teaching": {
    reason:
      "BDD-declared union (US-P3-02b) — Part 3 stall-scaffold consumer is the client-side detector; the typed pool shape is the follow-on PR.",
  },
  "StallType.abstraction-freeze.adminUI": {
    reason:
      "no per-stall-tag display in admin Modules tab today — added when scaffoldPool entries gain the tag discriminator (follow-on PR).",
  },
  "StallType.abstraction-freeze.learnerUI": {
    reason:
      "the scaffold TEXT is learner-facing; the TAG NAME is internal-only per Lattice learner-UI-leak coverage.",
  },
  "StallType.vocabulary-search.teaching": {
    reason:
      "BDD-declared union (US-P3-02b) — Part 3 stall-scaffold consumer is the client-side detector; the typed pool shape is the follow-on PR.",
  },
  "StallType.vocabulary-search.adminUI": {
    reason:
      "no per-stall-tag display in admin Modules tab today — added when scaffoldPool entries gain the tag discriminator (follow-on PR).",
  },
  "StallType.vocabulary-search.learnerUI": {
    reason:
      "the scaffold TEXT is learner-facing; the TAG NAME is internal-only per Lattice learner-UI-leak coverage.",
  },
  "StallType.blank-out.teaching": {
    reason:
      "BDD-declared union (US-P3-02b) — Part 3 stall-scaffold consumer is the client-side detector; the typed pool shape is the follow-on PR.",
  },
  "StallType.blank-out.adminUI": {
    reason:
      "no per-stall-tag display in admin Modules tab today — added when scaffoldPool entries gain the tag discriminator (follow-on PR).",
  },
  "StallType.blank-out.learnerUI": {
    reason:
      "the scaffold TEXT is learner-facing; the TAG NAME is internal-only per Lattice learner-UI-leak coverage.",
  },

  // ── ScoreReadoutMode — when/how scores reach the learner
  //   (IELTS course-ref v2.3 + HF-IELTS-Pre-Voice-Testing-Checklist Unit 5)
  // Consumer surface: end-of-module Results screen + tutor close transform.
  // The type is wired into AuthoredModuleSettings + the wizard parser this
  // PR; the runtime READ (Results panel branching, tutor close-line
  // variant selection) is the follow-on PR.
  "ScoreReadoutMode.on-screen.teaching": {
    reason:
      "course-ref v2.3 field — tutor close-line variant selection is the follow-on PR; today the close line is a single fixed string per module.",
  },
  "ScoreReadoutMode.on-screen.adminUI": {
    reason:
      "no Results-mode badge in admin Modules tab today — added when the Inspector G8 row ships (follow-on PR).",
  },
  "ScoreReadoutMode.on-screen.learnerUI": {
    reason:
      "Results screen (apps/foh/app/api/scores/route.ts) shows bands; mode-driven panel variant is the follow-on PR.",
  },
  "ScoreReadoutMode.end-of-module-on-screen.teaching": {
    reason:
      "course-ref v2.3 field — tutor close-line variant selection is the follow-on PR; today the close line is a single fixed string per module.",
  },
  "ScoreReadoutMode.end-of-module-on-screen.adminUI": {
    reason:
      "no Results-mode badge in admin Modules tab today — added when the Inspector G8 row ships (follow-on PR).",
  },
  "ScoreReadoutMode.end-of-module-on-screen.learnerUI": {
    reason:
      "Results screen (apps/foh/app/api/scores/route.ts) shows bands; mode-driven panel variant is the follow-on PR.",
  },
  "ScoreReadoutMode.aloud-with-indicative-qualifier.teaching": {
    reason:
      "course-ref v2.3 Mock field — tutor 'indicative bands aloud' variant is the follow-on PR; today the close-line transform is fixed.",
  },
  "ScoreReadoutMode.aloud-with-indicative-qualifier.adminUI": {
    reason:
      "no Results-mode badge in admin Modules tab today — added when the Inspector G8 row ships (follow-on PR).",
  },
  "ScoreReadoutMode.aloud-with-indicative-qualifier.learnerUI": {
    reason:
      "Results screen (apps/foh/app/api/scores/route.ts) shows bands; mode-driven panel variant is the follow-on PR.",
  },
};

/** Ratchet — every cell defaults to exempt at land time. As consumers ship
 *  in follow-on PRs, drop EXPECTED_EXEMPT_COUNT one at a time. Total cells:
 *    CueCardType (2) × axes (3) = 6 — adminUI axis wired by S6 of #2185
 *      via components/content-tab/CueCardRowEditor.tsx, so 2 exempts dropped.
 *    StallType (5) × axes (3) = 15
 *    ScoreReadoutMode (3) × axes (3) = 9
 *    Total = 30 − 2 = 28 */
const EXPECTED_EXEMPT_COUNT = 28;

/** Ratchet — zero gaps at land time. New values added to any union without
 *  a corresponding exempt or wired consumer fail this. */
const EXPECTED_GAP_COUNT = 0;

// ────────────────────────────────────────────────────────────
// Source-walk + classification — same shape as mode-ui-coverage.
// ────────────────────────────────────────────────────────────

function walkSource(dir: string): string[] {
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
      if (e === "node_modules" || e === "__tests__" || e === ".next") continue;
      out.push(...walkSource(full));
    } else if (
      (e.endsWith(".ts") || e.endsWith(".tsx")) &&
      !e.endsWith(".test.ts") &&
      !e.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

function concatSourceForAxis(axis: Axis): string {
  const files: string[] = [];
  for (const rel of AXIS_DIRS[axis]) {
    files.push(...walkSource(resolve(REPO_ADMIN, rel)));
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
}

const AXIS_SOURCE: Record<Axis, string> = {
  teaching: concatSourceForAxis("teaching"),
  adminUI: concatSourceForAxis("adminUI"),
  learnerUI: concatSourceForAxis("learnerUI"),
};

/** Match a value literal in a real consumer context — accessed as a
 *  property comparison or destructure target. Pattern intentionally tight
 *  to avoid incidental string-literal collisions (e.g. "personal" in PII
 *  enum). Requires the value to appear in:
 *    - `=== "<value>"` or `!== "<value>"` (variable comparison)
 *    - `case "<value>":` (switch)
 *  Any one match counts as `covered`. */
function valueIsConsumed(value: string, source: string): boolean {
  const esc = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:[!=]==\\s*["']${esc}["'])|(?:case\\s+["']${esc}["']\\s*:)`,
    "m",
  );
  return re.test(source);
}

type Classification = "covered" | "exempt" | "gap";

interface CellResult {
  union: UnionName;
  value: string;
  axis: Axis;
  key: CellKey;
  classification: Classification;
  reason?: string;
}

function classifyCell(
  union: UnionName,
  value: string,
  axis: Axis,
): CellResult {
  const key: CellKey = `${union}.${value}.${axis}`;
  const exempt = UNION_AXIS_EXEMPT[key];
  if (exempt) {
    return { union, value, axis, key, classification: "exempt", reason: exempt.reason };
  }
  if (valueIsConsumed(value, AXIS_SOURCE[axis])) {
    return { union, value, axis, key, classification: "covered" };
  }
  return { union, value, axis, key, classification: "gap" };
}

// Collect all cells across all three unions × all three axes.
function allCells(): CellResult[] {
  const out: CellResult[] = [];
  for (const v of CUE_CARD_TYPE_VALUES) {
    for (const a of AXES) out.push(classifyCell("CueCardType", v, a));
  }
  for (const v of STALL_TYPE_VALUES) {
    for (const a of AXES) out.push(classifyCell("StallType", v, a));
  }
  for (const v of SCORE_READOUT_MODE_VALUES) {
    for (const a of AXES) out.push(classifyCell("ScoreReadoutMode", v, a));
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("BDD typed unions coverage (#2162) — three-axis matrix", () => {
  const results = allCells();

  it("test matrix matches the source-of-truth type unions in json-fields.ts", () => {
    const src = readFileSync(TYPE_SOURCE_PATH, "utf8");

    // CueCardType
    const ccMatch = src.match(
      /export\s+type\s+CueCardType\s*=\s*([^;]+);/m,
    );
    expect(ccMatch, "CueCardType export not found in json-fields.ts").toBeTruthy();
    const ccSrc = (ccMatch![1].match(/["']([^"']+)["']/g) ?? []).map((s) =>
      s.replace(/["']/g, ""),
    );
    expect(ccSrc.sort()).toEqual([...CUE_CARD_TYPE_VALUES].sort());

    // StallType
    const stMatch = src.match(
      /export\s+type\s+StallType\s*=\s*([^;]+);/m,
    );
    expect(stMatch, "StallType export not found in json-fields.ts").toBeTruthy();
    const stSrc = (stMatch![1].match(/["']([^"']+)["']/g) ?? []).map((s) =>
      s.replace(/["']/g, ""),
    );
    expect(stSrc.sort()).toEqual([...STALL_TYPE_VALUES].sort());

    // ScoreReadoutMode
    const srmMatch = src.match(
      /export\s+type\s+ScoreReadoutMode\s*=\s*([^;]+);/m,
    );
    expect(
      srmMatch,
      "ScoreReadoutMode export not found in json-fields.ts",
    ).toBeTruthy();
    const srmSrc = (srmMatch![1].match(/["']([^"']+)["']/g) ?? []).map((s) =>
      s.replace(/["']/g, ""),
    );
    expect(srmSrc.sort()).toEqual([...SCORE_READOUT_MODE_VALUES].sort());
  });

  it("no (union, value, axis) cell is an uncovered gap beyond the ratchet", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps.length,
      `Producer-only union/value cells (no consumer found, no exemption):\n  ${gaps
        .map((g) => g.key)
        .join(
          "\n  ",
        )}\n\nFix: wire the consumer OR add to UNION_AXIS_EXEMPT with a >20-char reason.`,
    ).toBeLessThanOrEqual(EXPECTED_GAP_COUNT);
  });

  it("ratchet — gap count matches EXPECTED_GAP_COUNT exactly", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps.length,
      `Gap count drifted from ${EXPECTED_GAP_COUNT}. ` +
        `Current gaps: ${gaps.map((g) => g.key).join(", ")}. ` +
        `If you closed a gap, drop EXPECTED_GAP_COUNT. ` +
        `If you opened one, pause: wire the consumer instead.`,
    ).toBe(EXPECTED_GAP_COUNT);
  });

  it("ratchet — exempt count matches EXPECTED_EXEMPT_COUNT exactly", () => {
    const ex = Object.keys(UNION_AXIS_EXEMPT);
    expect(
      ex.length,
      `Exempt-list size drifted from ${EXPECTED_EXEMPT_COUNT}. ` +
        `Current: ${ex.length} entries. ` +
        `If you removed an exemption (wired the consumer), drop the constant. ` +
        `If you added one, was that intentional?`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a substantive reason (>20 chars)", () => {
    for (const [k, entry] of Object.entries(UNION_AXIS_EXEMPT)) {
      expect(
        entry!.reason.trim().length,
        `${k}: reason too short (${entry!.reason.length} chars) — write what makes this cell intentionally exempt`,
      ).toBeGreaterThan(20);
    }
  });

  it("no exempt entry is contradicted by an actual consumer match", () => {
    const contradicted: string[] = [];
    for (const k of Object.keys(UNION_AXIS_EXEMPT)) {
      const parts = k.split(".");
      // key format: UnionName.value.axis. Values may contain hyphens but
      // never dots; UnionName is one of three known. Axis is one of three.
      const union = parts[0];
      const axis = parts[parts.length - 1] as Axis;
      const value = parts.slice(1, -1).join(".");
      if (!AXES.includes(axis)) continue;
      const _ = union; // keep readable; classifier doesn't need union for source match
      void _;
      if (valueIsConsumed(value, AXIS_SOURCE[axis])) {
        contradicted.push(k);
      }
    }
    expect(
      contradicted,
      `Exempt entries that now have real consumer matches — remove from UNION_AXIS_EXEMPT:\n  ${contradicted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no exempt entry references an unknown union value (stale row)", () => {
    const known = new Set<string>([
      ...CUE_CARD_TYPE_VALUES.map((v) => `CueCardType.${v}`),
      ...STALL_TYPE_VALUES.map((v) => `StallType.${v}`),
      ...SCORE_READOUT_MODE_VALUES.map((v) => `ScoreReadoutMode.${v}`),
    ]);
    const stale: string[] = [];
    for (const k of Object.keys(UNION_AXIS_EXEMPT)) {
      // strip trailing `.axis`
      const tail = k.lastIndexOf(".");
      const head = k.slice(0, tail);
      if (!known.has(head)) stale.push(k);
    }
    expect(stale, `Stale exempt entries: ${stale.join(", ")}`).toEqual([]);
  });

  it("classification distribution sanity (operator-facing log)", () => {
    const counts: Record<Classification, number> = {
      covered: 0,
      exempt: 0,
      gap: 0,
    };
    for (const r of results) counts[r.classification]++;
    const total =
      (CUE_CARD_TYPE_VALUES.length +
        STALL_TYPE_VALUES.length +
        SCORE_READOUT_MODE_VALUES.length) *
      AXES.length;
    expect(counts.covered + counts.exempt + counts.gap).toBe(total);
    expect(counts.exempt).toBe(EXPECTED_EXEMPT_COUNT);
    expect(counts.gap).toBe(EXPECTED_GAP_COUNT);
  });

  // Stop unused-variable lint complaints — types are exported as
  // ambient signal that the test file lives next to the type union.
  it("imports the union types (compile-time sanity)", () => {
    const a: CueCardType = "personal";
    const b: StallType = "i-dont-know";
    const c: ScoreReadoutMode = "on-screen";
    expect(a).toBe("personal");
    expect(b).toBe("i-dont-know");
    expect(c).toBe("on-screen");
  });
});
