/**
 * detect-module-settings.test.ts
 *
 * Pins the YAML-block parser for per-module G8 settings (#1850).
 * Covers: IELTS v2.3 happy path, malformed YAML, missing block, unknown
 * field, shape mismatch, module-id whitelist, empty corpora.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectModuleSettings } from "@/lib/wizard/detect-module-settings";

const FIXTURE_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "lib",
  "wizard",
  "__tests__",
  "fixtures",
);
const IELTS_V23 = readFileSync(
  join(FIXTURE_DIR, "course-reference-ielts-v2.3.md"),
  "utf-8",
);
const IELTS_V22 = readFileSync(
  join(FIXTURE_DIR, "course-reference-ielts-v2.2.md"),
  "utf-8",
);

describe("detectModuleSettings — IELTS v2.3 happy path", () => {
  const KNOWN_IDS = ["baseline", "part1", "part2", "part3", "mock"];

  it("parses 5 YAML blocks, one per IELTS module", () => {
    const r = detectModuleSettings(IELTS_V23, KNOWN_IDS);
    expect(r.blockCount).toBe(5);
    expect(r.byModuleId.size).toBe(5);
    expect(Array.from(r.byModuleId.keys()).sort()).toEqual(
      [...KNOWN_IDS].sort(),
    );
  });

  it("emits zero warnings on the v2.3 fixture", () => {
    const r = detectModuleSettings(IELTS_V23, KNOWN_IDS);
    expect(r.validationWarnings).toEqual([]);
  });

  it("captures the part2 settings end-to-end", () => {
    const r = detectModuleSettings(IELTS_V23, KNOWN_IDS);
    const part2 = r.byModuleId.get("part2");
    expect(part2).toBeDefined();
    expect(part2!.minSpeakingSec).toBe(120);
    expect(part2!.questionTarget).toEqual({ min: 1, target: 1 });
    expect(part2!.closingLine).toBe(
      "That's the end of Part 2. Take a moment, then we'll move on.",
    );
    expect(part2!.scheduledCues).toEqual([
      { at: 45, text: "15 seconds left" },
      { at: 60, text: "Your two minutes start now" },
    ]);
    // The closingLine should NOT be emitted as `moduleClosingLine`
    // (the parser strips the `module` prefix when present, but the v2.3
    // fixture uses the bare form — both produce `closingLine`).
    expect((part2 as Record<string, unknown>).moduleClosingLine).toBeUndefined();
  });

  it("captures empty scheduledCues as an empty array on student-led modules", () => {
    const r = detectModuleSettings(IELTS_V23, KNOWN_IDS);
    const part1 = r.byModuleId.get("part1");
    expect(part1!.scheduledCues).toEqual([]);
  });

  it("captures multi-line block-literal firstTimeOrientationLine intact", () => {
    const r = detectModuleSettings(IELTS_V23, KNOWN_IDS);
    const baseline = r.byModuleId.get("baseline");
    expect(baseline!.firstTimeOrientationLine).toContain(
      "This is a relaxed first call",
    );
    expect(baseline!.firstTimeOrientationLine).toContain(
      "About twenty minutes total.",
    );
    // Block literals contain real newlines:
    expect(baseline!.firstTimeOrientationLine!.split("\n").length).toBeGreaterThan(2);
  });
});

describe("detectModuleSettings — v2.2 fixture (no YAML blocks)", () => {
  it("returns an empty map and zero warnings on a doc without settings blocks", () => {
    const r = detectModuleSettings(IELTS_V22, []);
    expect(r.blockCount).toBe(0);
    expect(r.byModuleId.size).toBe(0);
    expect(r.validationWarnings).toEqual([]);
  });
});

describe("detectModuleSettings — error / edge cases", () => {
  it("warns when a YAML block has no moduleId key", () => {
    const md = [
      "#### Module 1 — Anonymous — Settings",
      "",
      "```yaml",
      "settings:",
      "  minSpeakingSec: 60",
      "```",
    ].join("\n");
    const r = detectModuleSettings(md, []);
    expect(r.byModuleId.size).toBe(0);
    expect(r.validationWarnings).toHaveLength(1);
    expect(r.validationWarnings[0].code).toBe("MODULE_SETTINGS_NO_MODULE_ID");
  });

  it("warns when an unknown field is present and skips it but keeps siblings", () => {
    const md = [
      "#### Module 1 — Mock — Settings",
      "",
      "```yaml",
      "moduleId: mock",
      "settings:",
      "  minSpeakingSec: 60",
      "  someUnknownField: 42",
      "```",
    ].join("\n");
    const r = detectModuleSettings(md, ["mock"]);
    expect(r.byModuleId.get("mock")).toEqual({ minSpeakingSec: 60 });
    expect(
      r.validationWarnings.some(
        (w) => w.code === "MODULE_SETTINGS_UNKNOWN_FIELD",
      ),
    ).toBe(true);
  });

  it("warns when a field has the wrong shape (questionTarget as scalar)", () => {
    const md = [
      "#### Module 1 — Mock — Settings",
      "",
      "```yaml",
      "moduleId: mock",
      "settings:",
      "  questionTarget: 42",
      "  closingLine: ok",
      "```",
    ].join("\n");
    const r = detectModuleSettings(md, ["mock"]);
    // closingLine still wins; questionTarget skipped
    expect(r.byModuleId.get("mock")).toEqual({ closingLine: "ok" });
    expect(
      r.validationWarnings.some(
        (w) => w.code === "MODULE_SETTINGS_TYPE_MISMATCH",
      ),
    ).toBe(true);
  });

  it("warns when the moduleId is not in the known catalogue", () => {
    const md = [
      "#### Module 1 — Mystery — Settings",
      "",
      "```yaml",
      "moduleId: ghost",
      "settings:",
      "  minSpeakingSec: 60",
      "```",
    ].join("\n");
    const r = detectModuleSettings(md, ["mock", "part1"]);
    expect(r.byModuleId.size).toBe(0);
    expect(
      r.validationWarnings.some(
        (w) => w.code === "MODULE_SETTINGS_UNKNOWN_MODULE",
      ),
    ).toBe(true);
  });

  it("warns when the YAML fence is opened but never closed", () => {
    const md = [
      "#### Module 1 — Mock — Settings",
      "",
      "```yaml",
      "moduleId: mock",
      "settings:",
      "  minSpeakingSec: 60",
    ].join("\n");
    const r = detectModuleSettings(md, ["mock"]);
    expect(r.byModuleId.size).toBe(0);
    expect(
      r.validationWarnings.some(
        (w) => w.code === "MODULE_SETTINGS_FENCE_UNCLOSED",
      ),
    ).toBe(true);
  });

  it("ignores non-schema fields silently (no spurious warnings)", () => {
    // appliesTo, prepSilenceSec, scoringCriteria are intentionally
    // not in AuthoredModuleSettings — parser should NOT emit
    // MODULE_SETTINGS_UNKNOWN_FIELD warnings for them.
    const md = [
      "#### Module 1 — Mock — Settings",
      "",
      "```yaml",
      "moduleId: mock",
      "appliesTo: [exam, structured]",
      "settings:",
      "  prepSilenceSec: 60",
      "  scoringCriteria: [FC, LR]",
      "  scoreReadoutMode: aloud",
      "  minSpeakingSec: 60",
      "```",
    ].join("\n");
    const r = detectModuleSettings(md, ["mock"]);
    expect(r.byModuleId.get("mock")).toEqual({ minSpeakingSec: 60 });
    // No UNKNOWN_FIELD warnings for the documented non-schema fields:
    expect(
      r.validationWarnings.filter(
        (w) => w.code === "MODULE_SETTINGS_UNKNOWN_FIELD",
      ),
    ).toEqual([]);
  });

  it("strips the `module` prefix from doc-form field names", () => {
    // The task spec calls out the YAML can use `moduleClosingLine`;
    // the v2.3 fixture uses the bare `closingLine` form. Pin both
    // map to the same emitted key.
    const md = [
      "#### Module 1 — Mock — Settings",
      "",
      "```yaml",
      "moduleId: mock",
      "settings:",
      "  moduleClosingLine: |",
      "    bye",
      "  moduleMinSpeakingSec: 30",
      "```",
    ].join("\n");
    const r = detectModuleSettings(md, ["mock"]);
    expect(r.byModuleId.get("mock")).toEqual({
      closingLine: "bye",
      minSpeakingSec: 30,
    });
  });

  it("returns an empty result on an empty corpus", () => {
    const r = detectModuleSettings("", []);
    expect(r.blockCount).toBe(0);
    expect(r.byModuleId.size).toBe(0);
    expect(r.validationWarnings).toEqual([]);
  });
});
