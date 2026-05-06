import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectAuthoredModules,
  hasAuthoredModules,
  type DetectedAuthoredModules,
} from "../detect-authored-modules";

const FIXTURES = join(__dirname, "fixtures");
const IELTS_V22 = readFileSync(join(FIXTURES, "course-reference-ielts-v2.2.md"), "utf-8");

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
    for (const m of result.modules) {
      expect(m.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(m.id.length).toBeLessThanOrEqual(32);
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
