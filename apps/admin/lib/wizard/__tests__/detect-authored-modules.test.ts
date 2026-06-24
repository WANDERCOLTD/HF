import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectAuthoredModules,
  extractOutcomeStatements,
  hasAuthoredModules,
  type DetectedAuthoredModules,
} from "../detect-authored-modules";

const FIXTURES = join(__dirname, "fixtures");
const IELTS_V22 = readFileSync(join(FIXTURES, "course-reference-ielts-v2.2.md"), "utf-8");
const IELTS_V23 = readFileSync(join(FIXTURES, "course-reference-ielts-v2.3.md"), "utf-8");

// ── IELTS v2.2 — full positive case ────────────────────────────────────

describe("detectAuthoredModules — IELTS v2.2 fixture", () => {
  let result: DetectedAuthoredModules;

  it("parses without throwing and produces a result", () => {
    result = detectAuthoredModules(IELTS_V22);
    expect(result).toBeDefined();
    expect(result.modulesAuthored).toBe(true);
  });

  it("extracts exactly 5 modules", () => {
    expect(result.modules).toHaveLength(5);
    expect(result.modules.map((m) => m.id)).toEqual([
      "baseline",
      "part1",
      "part2",
      "part3",
      "mock",
    ]);
  });

  it("captures the Baseline module's contract correctly", () => {
    const baseline = result.modules.find((m) => m.id === "baseline");
    expect(baseline).toBeDefined();
    expect(baseline!.label).toBe("Baseline Assessment");
    expect(baseline!.mode).toBe("examiner");
    expect(baseline!.frequency).toBe("once");
    expect(baseline!.sessionTerminal).toBe(true);
    expect(baseline!.voiceBandReadout).toBe(false);
    expect(baseline!.learnerSelectable).toBe(true);
  });

  it("captures the Part 1 module's contract correctly", () => {
    const part1 = result.modules.find((m) => m.id === "part1");
    expect(part1).toBeDefined();
    expect(part1!.label).toBe("Part 1: Familiar Topics");
    expect(part1!.mode).toBe("tutor");
    expect(part1!.frequency).toBe("repeatable");
    expect(part1!.sessionTerminal).toBe(false);
    expect(part1!.outcomesPrimary).toEqual(
      expect.arrayContaining(["OUT-01", "OUT-02", "OUT-05", "OUT-06", "OUT-07", "OUT-24"]),
    );
  });

  it("captures the Part 2 module as mixed-mode with all four criteria", () => {
    const part2 = result.modules.find((m) => m.id === "part2");
    expect(part2).toBeDefined();
    expect(part2!.mode).toBe("mixed");
    expect(part2!.scoringFired.toLowerCase()).toContain("all four");
  });

  it("captures the Mock Exam module with voice band readout enabled", () => {
    const mock = result.modules.find((m) => m.id === "mock");
    expect(mock).toBeDefined();
    expect(mock!.mode).toBe("examiner");
    expect(mock!.voiceBandReadout).toBe(true);
    expect(mock!.sessionTerminal).toBe(true);
    expect(mock!.frequency).toBe("repeatable");
    expect(mock!.outcomesPrimary).toEqual(["OUT-25", "OUT-26", "OUT-27"]);
  });

  it("enforces ID regex on every parsed module", () => {
    // Pattern relaxed to include hyphens + length cap raised to 80
    // (CIO/CTO unit-doc IDs). Updated 2026-06-20 for the trio-import fix.
    for (const m of result.modules) {
      expect(m.id).toMatch(/^[a-z][a-z0-9_-]*$/);
      expect(m.id.length).toBeLessThanOrEqual(80);
    }
  });

  it("emits no errors and no field-defaulting warnings for the IELTS fixture", () => {
    const errors = result.validationWarnings.filter((w) => w.severity === "error");
    expect(errors).toEqual([]);
    const defaultedWarnings = result.validationWarnings.filter(
      (w) => w.code === "MODULE_FIELD_DEFAULTED",
    );
    expect(defaultedWarnings).toEqual([]);
  });

  it("surfaces a header-footer consistency check (both declare Yes — no warning)", () => {
    const inconsistencyWarnings = result.validationWarnings.filter(
      (w) => w.code === "MODULES_AUTHORED_INCONSISTENT",
    );
    expect(inconsistencyWarnings).toEqual([]);
  });

  it("parses Module Defaults from the Modules section", () => {
    expect(result.moduleDefaults.mode).toBe("tutor");
    expect(result.moduleDefaults.correctionStyle).toBe("single_issue_loop");
    expect(result.moduleDefaults.theoryDelivery).toBe("embedded_only");
    expect(result.moduleDefaults.bandVisibility).toBe("hidden_mid_module");
    expect(result.moduleDefaults.intake).toBe("none");
  });
});

// ── IELTS v2.3 — per-module YAML settings extension (#1850) ────────────

describe("detectAuthoredModules — IELTS v2.3 per-module settings", () => {
  let result: DetectedAuthoredModules;

  it("parses v2.3 without errors and produces 5 modules", () => {
    result = detectAuthoredModules(IELTS_V23);
    expect(result.modulesAuthored).toBe(true);
    expect(result.modules).toHaveLength(5);
  });

  it("populates AuthoredModule.settings from the per-module YAML blocks", () => {
    for (const m of result.modules) {
      expect(m.settings).toBeDefined();
      expect(typeof m.settings!.minSpeakingSec).toBe("number");
      expect(m.settings!.questionTarget).toMatchObject({
        min: expect.any(Number),
        target: expect.any(Number),
      });
      expect(typeof m.settings!.closingLine).toBe("string");
      expect(typeof m.settings!.firstTimeOrientationLine).toBe("string");
      expect(Array.isArray(m.settings!.scheduledCues)).toBe(true);
    }
  });

  it("carries the part2 cue-card cue schedule end-to-end", () => {
    const part2 = result.modules.find((m) => m.id === "part2")!;
    // #2277 — Part 2 now carries 5 cues: PPF prep intro + 45s warn +
    // monologue boundary + re-speak offer + re-speak close. Cue-scheduler
    // is voice-only per PR #2286; BDD-acceptable since real IELTS
    // examiners speak prep instructions verbally.
    expect(part2.settings!.scheduledCues).toEqual([
      {
        at: 0,
        text: "You'll have one minute to prepare. Think of a specific memory or moment. Consider past, present, and future. Write three bullet points — one word or phrase per line.",
        phase: "p2_prep_start",
      },
      { at: 45, text: "Fifteen seconds left." },
      // #1762 Story C — 60s cue carries phase:"p2_monologue" so the
      // Session.metadata.phaseBoundaries write surface knows the
      // prep→monologue boundary is at this cue (not just a text label).
      {
        at: 60,
        text: "Your time starts now — go ahead.",
        phase: "p2_monologue",
      },
      {
        at: 181,
        text: "Your structure was clear — let's try once more. Same topic. Start when you're ready.",
        phase: "p2_respeak",
      },
      {
        at: 241,
        text: "Good — that's your minute. Well done.",
        phase: "p2_respeak_close",
      },
    ]);
    expect(part2.settings!.minSpeakingSec).toBe(120);
  });

  it("emits no errors for the v2.3 fixture (warnings allowed for non-schema fields)", () => {
    const errors = result.validationWarnings.filter((w) => w.severity === "error");
    expect(errors).toEqual([]);
  });
});

// ── Negative: explicit "No" ────────────────────────────────────────────

describe("detectAuthoredModules — explicit No declaration", () => {
  it("returns modulesAuthored=false and skips section parsing", () => {
    const doc = `# Test Course\n\n**Modules authored:** No\n\n## Modules\n\nThis section should be ignored.`;
    const result = detectAuthoredModules(doc);
    expect(result.modulesAuthored).toBe(false);
    expect(result.modules).toEqual([]);
    expect(result.validationWarnings.filter((w) => w.severity === "error")).toEqual([]);
  });
});

// ── Negative: no signal at all ─────────────────────────────────────────

describe("detectAuthoredModules — no Modules section, no flag", () => {
  it("returns modulesAuthored=null so derived path runs unchanged", () => {
    const doc = `# Generic Course\n\n## Course Configuration\n\n**Course name:** Whatever\n\n## Learning Outcomes\n\n**OUT-01:** Something.\n`;
    const result = detectAuthoredModules(doc);
    expect(result.modulesAuthored).toBeNull();
    expect(result.modules).toEqual([]);
    expect(result.validationWarnings).toEqual([]);
  });
});

// ── Heuristic: section present, no header flag ─────────────────────────

describe("detectAuthoredModules — heuristic section detection", () => {
  it("treats `## Modules` section as authored even without a flag", () => {
    const doc = `# Test Course\n\n## Modules\n\n### Module Catalogue\n\n| ID | Label | Mode | Duration | Scoring fired | Voice band readout | Session-terminal | Frequency |\n|---|---|---|---|---|---|---|---|\n| \`m1\` | Module One | tutor | 10 min | LR + GRA | No | No | repeatable |\n`;
    const result = detectAuthoredModules(doc);
    expect(result.modulesAuthored).toBe(true);
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].id).toBe("m1");
    expect(result.detectedFrom.some((d) => d.includes("heuristic"))).toBe(true);
  });
});

// ── Negative: missing required field triggers warning + default ────────

describe("detectAuthoredModules — missing field defaults with warning", () => {
  it("defaults missing mode and emits MODULE_FIELD_DEFAULTED warning", () => {
    const doc = `## Modules\n\n### Module Catalogue\n\n| ID | Label | Mode | Duration | Scoring fired | Voice band readout | Session-terminal | Frequency |\n|---|---|---|---|---|---|---|---|\n| \`m1\` | Module One |  | 10 min | LR + GRA | No | No | repeatable |\n`;
    const result = detectAuthoredModules(doc);
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].mode).toBe("tutor"); // template default
    const warning = result.validationWarnings.find(
      (w) => w.code === "MODULE_FIELD_DEFAULTED" && w.path === "modules.m1.mode",
    );
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe("warning");
  });
});

// ── Header/footer inconsistency ────────────────────────────────────────

describe("detectAuthoredModules — header/footer disagreement", () => {
  it("emits MODULES_AUTHORED_INCONSISTENT when header and footer disagree", () => {
    const doc = `# Course\n\n**Modules authored:** Yes\n\n## Modules\n\n### Module Catalogue\n\n| ID | Label | Mode | Duration | Scoring fired | Voice band readout | Session-terminal | Frequency |\n|---|---|---|---|---|---|---|---|\n| \`m1\` | Module One | tutor | 10 min | LR + GRA | No | No | repeatable |\n\n## Document Version\n\n**Modules authored:** No\n`;
    const result = detectAuthoredModules(doc);
    const inconsistency = result.validationWarnings.find(
      (w) => w.code === "MODULES_AUTHORED_INCONSISTENT",
    );
    expect(inconsistency).toBeDefined();
    expect(inconsistency!.severity).toBe("warning");
  });
});

// ── Invalid ID regex ───────────────────────────────────────────────────

describe("detectAuthoredModules — invalid module ID", () => {
  it("rejects an ID that does not match the pattern", () => {
    const doc = `## Modules\n\n### Module Catalogue\n\n| ID | Label | Mode | Duration | Scoring fired | Voice band readout | Session-terminal | Frequency |\n|---|---|---|---|---|---|---|---|\n| \`Bad-ID!\` | Bad | tutor | 10 min | LR | No | No | repeatable |\n`;
    const result = detectAuthoredModules(doc);
    expect(result.modules).toHaveLength(0);
    const err = result.validationWarnings.find((w) => w.code === "MODULE_ID_INVALID");
    expect(err).toBeDefined();
    expect(err!.severity).toBe("error");
  });
});

// ── Cross-reference: unknown prerequisite ──────────────────────────────

describe("detectAuthoredModules — unknown prerequisite", () => {
  it("flags a prerequisite that does not match a sibling module ID", () => {
    const doc = `## Modules\n\n### Module Catalogue\n\n| ID | Label | Mode | Duration | Scoring fired | Voice band readout | Session-terminal | Frequency | Prerequisites |\n|---|---|---|---|---|---|---|---|---|\n| \`m1\` | Module One | tutor | 10 min | LR | No | No | repeatable | none |\n| \`m2\` | Module Two | tutor | 10 min | LR | No | No | repeatable | mX |\n`;
    const result = detectAuthoredModules(doc);
    expect(result.modules).toHaveLength(2);
    const err = result.validationWarnings.find(
      (w) => w.code === "MODULE_PREREQUISITE_UNKNOWN" && w.path === "modules.m2.prerequisites",
    );
    expect(err).toBeDefined();
    expect(err!.severity).toBe("error");
  });
});

// ── Multi-segment OUT-NN-NN outcome IDs (#2000) ────────────────────────
// CIO/CTO Course References use dotted sub-outcome IDs (`OUT-01-02`) to
// partition sub-outcomes under each primary outcome. Pre-fix, both the
// heading detector and the table-cell parser captured only the first
// numeric segment, collapsing 26 outcomes into 5 per playbook.

describe("extractOutcomeStatements — multi-segment OUT-NN-NN (#2000)", () => {
  it("captures `**OUT-01-02: ...**` headings as the full multi-segment ID", () => {
    const doc = [
      "# CIO/CTO Pop Quiz",
      "",
      "**OUT-01-02: Identifies the primary risk vector in a phishing scenario.**",
      "**OUT-01-03: Distinguishes social engineering from credential theft.**",
      "**OUT-12-04: Explains rotation cadence for production secrets.**",
    ].join("\n");
    const outcomes = extractOutcomeStatements(doc);
    expect(Object.keys(outcomes).sort()).toEqual(["OUT-01-02", "OUT-01-03", "OUT-12-04"]);
    expect(outcomes["OUT-01-02"]).toBe("Identifies the primary risk vector in a phishing scenario");
    expect(outcomes["OUT-12-04"]).toBe("Explains rotation cadence for production secrets");
  });

  it("keeps single-segment `**OUT-NN: ...**` headings (back-compat)", () => {
    const doc = [
      "# IELTS Course",
      "",
      "**OUT-01: Extends every answer past the minimum length.**",
      "**OUT-27: Sustains performance across all four criteria.**",
    ].join("\n");
    const outcomes = extractOutcomeStatements(doc);
    expect(Object.keys(outcomes).sort()).toEqual(["OUT-01", "OUT-27"]);
  });
});

describe("detectAuthoredModules — parseOutcomesList multi-segment (#2000)", () => {
  function buildCatalogue(outcomesCell: string): string {
    return [
      "# Course",
      "",
      "**Modules authored:** Yes",
      "",
      "## Modules",
      "",
      "### Module Catalogue",
      "",
      "| ID | Label | Mode | Duration | Scoring fired | Voice band readout | Session-terminal | Frequency | Outcomes (primary) |",
      "|---|---|---|---|---|---|---|---|---|",
      `| \`m1\` | Module One | tutor | 10 min | LR | No | No | repeatable | ${outcomesCell} |`,
      "",
    ].join("\n");
  }

  it("parses `OUT-01-02, OUT-01-03` into two distinct multi-segment IDs", () => {
    const doc = buildCatalogue("OUT-01-02, OUT-01-03");
    const result = detectAuthoredModules(doc);
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].outcomesPrimary.sort()).toEqual(["OUT-01-02", "OUT-01-03"]);
  });

  it("pads each segment so `OUT-1-2` normalises to `OUT-01-02`", () => {
    const doc = buildCatalogue("OUT-1-2");
    const result = detectAuthoredModules(doc);
    expect(result.modules[0].outcomesPrimary).toEqual(["OUT-01-02"]);
  });

  it("preserves the single-segment short-form expansion (`OUT-01, 02, 05`)", () => {
    const doc = buildCatalogue("OUT-01, 02, 05");
    const result = detectAuthoredModules(doc);
    expect(result.modules[0].outcomesPrimary.sort()).toEqual(["OUT-01", "OUT-02", "OUT-05"]);
  });

  it("handles a mix of single- and multi-segment IDs in the same cell", () => {
    const doc = buildCatalogue("OUT-01, OUT-02-03, OUT-12-04");
    const result = detectAuthoredModules(doc);
    expect(result.modules[0].outcomesPrimary.sort()).toEqual([
      "OUT-01",
      "OUT-02-03",
      "OUT-12-04",
    ]);
  });
});

// ── hasAuthoredModules predicate ───────────────────────────────────────

describe("hasAuthoredModules", () => {
  it("returns true when modulesAuthored is true and modules exist", () => {
    const result = detectAuthoredModules(IELTS_V22);
    expect(hasAuthoredModules(result)).toBe(true);
  });

  it("returns false when modulesAuthored is null", () => {
    const result = detectAuthoredModules(`# Empty doc\n`);
    expect(hasAuthoredModules(result)).toBe(false);
  });

  it("returns false when modulesAuthored is false", () => {
    const result = detectAuthoredModules(`**Modules authored:** No\n`);
    expect(hasAuthoredModules(result)).toBe(false);
  });
});

// ── Mode normalisation — #2010 quiz + mock-exam (epic #2009) ───────────

/**
 * Build a minimal Module Catalogue with three rows, varying only the Mode
 * column. The CIO/CTO trio (Pop Quiz / Standard / Exam) declares modes
 * like "Quiz", "Mock-Exam", and "Mock Exam" (space variant); pre-#2010
 * these all fell through `normaliseMode` to `null` and were silently
 * dropped to the `defaults.mode ?? "tutor"` fallback at the call site.
 */
function buildMinimalModesFixture(modes: readonly string[]): string {
  const rows = modes
    .map(
      (m, idx) =>
        `| \`mod_${idx}\` | Module ${idx} | Yes | ${m} | 20 min | All four | No | No | Once | Source 1 | OUT-01 |`,
    )
    .join("\n");
  return `# Course Reference

## Modules

**Modules authored:** Yes

### Module Catalogue (machine-readable summary)

| ID | Label | Learner-selectable | Mode | Duration | Scoring fired | Voice band readout | Session-terminal | Frequency | Content source | Outcomes (primary) |
|---|---|---|---|---|---|---|---|---|---|---|
${rows}

**OUT-01: Sample outcome statement for module mode tests.**
`;
}

describe("detectAuthoredModules — mode parsing #2010 (quiz, mock-exam)", () => {
  it("parses Mode: Quiz to 'quiz' (not silently dropped to tutor)", () => {
    const result = detectAuthoredModules(buildMinimalModesFixture(["Quiz"]));
    expect(result.modulesAuthored).toBe(true);
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].mode).toBe("quiz");
  });

  it("parses Mode: Mock-Exam (hyphenated) to 'mock-exam'", () => {
    const result = detectAuthoredModules(buildMinimalModesFixture(["Mock-Exam"]));
    expect(result.modules[0].mode).toBe("mock-exam");
  });

  it("parses Mode: Mock exam (space variant) to 'mock-exam'", () => {
    const result = detectAuthoredModules(buildMinimalModesFixture(["Mock exam"]));
    expect(result.modules[0].mode).toBe("mock-exam");
  });

  it("regression — existing modes still parse correctly", () => {
    const result = detectAuthoredModules(
      buildMinimalModesFixture(["Tutor", "Mixed", "Examiner"]),
    );
    expect(result.modules.map((m) => m.mode)).toEqual([
      "tutor",
      "mixed",
      "examiner",
    ]);
  });
});
