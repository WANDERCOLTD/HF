/**
 * backfill-module-settings.test.ts
 *
 * Pure-function tests for the backfill plan / merge helpers (#1850).
 * No Prisma — feeds the helpers a mock Playbook config + course-ref text
 * and asserts the resulting diff + next-config shape.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  mergeModuleSettings,
  computeBackfillPlan,
} from "@/scripts/backfill-module-settings-from-course-ref";
import type {
  AuthoredModule,
  AuthoredModuleSettings,
  PlaybookConfig,
} from "@/lib/types/json-fields";

const IELTS_V23 = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "lib",
    "wizard",
    "__tests__",
    "fixtures",
    "course-reference-ielts-v2.3.md",
  ),
  "utf-8",
);

function makeModule(id: string, label: string, settings?: AuthoredModuleSettings): AuthoredModule {
  return {
    id,
    label,
    learnerSelectable: true,
    mode: "tutor",
    duration: "Student-led",
    scoringFired: "All four criteria",
    voiceBandReadout: false,
    sessionTerminal: false,
    frequency: "repeatable",
    contentSourceRef: undefined,
    outcomesPrimary: [],
    prerequisites: [],
    ...(settings ? { settings } : {}),
  };
}

describe("mergeModuleSettings — manual-edit-wins semantics", () => {
  it("merges new keys into an empty existing object", () => {
    const { merged, added, preserved } = mergeModuleSettings(undefined, {
      minSpeakingSec: 600,
      closingLine: "Bye",
    });
    expect(merged).toEqual({ minSpeakingSec: 600, closingLine: "Bye" });
    expect(added.sort()).toEqual(["closingLine", "minSpeakingSec"]);
    expect(preserved).toEqual([]);
  });

  it("preserves manual edits — existing key wins over YAML", () => {
    const existing: AuthoredModuleSettings = { closingLine: "MANUAL" };
    const { merged, added, preserved } = mergeModuleSettings(existing, {
      closingLine: "FROM_YAML",
      minSpeakingSec: 600,
    });
    expect(merged.closingLine).toBe("MANUAL");
    expect(merged.minSpeakingSec).toBe(600);
    expect(added).toEqual(["minSpeakingSec"]);
    expect(preserved).toEqual(["closingLine"]);
  });

  it("no-op when every YAML key already has a manual value", () => {
    const existing: AuthoredModuleSettings = {
      closingLine: "MANUAL",
      minSpeakingSec: 999,
    };
    const { merged, added, preserved } = mergeModuleSettings(existing, {
      closingLine: "FROM_YAML",
      minSpeakingSec: 600,
    });
    expect(merged).toEqual(existing);
    expect(added).toEqual([]);
    expect(preserved.sort()).toEqual(["closingLine", "minSpeakingSec"]);
  });
});

describe("computeBackfillPlan — IELTS v2.3 against a clean Playbook", () => {
  const config: PlaybookConfig = {
    modules: [
      makeModule("baseline", "Baseline Assessment"),
      makeModule("part1", "Part 1"),
      makeModule("part2", "Part 2"),
      makeModule("part3", "Part 3"),
      makeModule("mock", "Mock Exam"),
    ],
  };

  it("plans adds across every IELTS module", () => {
    const plan = computeBackfillPlan(config, IELTS_V23);
    expect(plan.yamlBlockCount).toBe(5);
    expect(plan.parserWarnings).toBe(0);
    expect(plan.diffs).toHaveLength(5);
    for (const d of plan.diffs) {
      expect(d.skipped).toBe(false);
      expect(d.added.length).toBeGreaterThan(0);
      expect(d.preserved).toEqual([]);
    }
  });

  it("the resulting nextConfig carries the part2 cue schedule", () => {
    const plan = computeBackfillPlan(config, IELTS_V23);
    const part2 = plan.nextConfig.modules!.find((m) => m.id === "part2")!;
    expect(part2.settings).toBeDefined();
    expect(part2.settings!.minSpeakingSec).toBe(120);
    expect(part2.settings!.scheduledCues).toEqual([
      { at: 45, text: "15 seconds left" },
      { at: 60, text: "Your two minutes start now" },
    ]);
  });

  it("does not mutate the input config", () => {
    const snapshot = JSON.stringify(config);
    computeBackfillPlan(config, IELTS_V23);
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});

describe("computeBackfillPlan — partial overlap + preservation", () => {
  it("preserves existing settings + adds the missing ones", () => {
    const config: PlaybookConfig = {
      modules: [
        makeModule("part2", "Part 2", {
          closingLine: "I am a manually-edited closing line.",
        }),
        makeModule("ghost", "Ghost module not in the doc"),
      ],
    };
    const plan = computeBackfillPlan(config, IELTS_V23);
    const part2Diff = plan.diffs.find((d) => d.id === "part2")!;
    expect(part2Diff.skipped).toBe(false);
    expect(part2Diff.preserved).toEqual(["closingLine"]);
    expect(part2Diff.added).toContain("minSpeakingSec");
    expect(part2Diff.added).toContain("scheduledCues");
    const ghostDiff = plan.diffs.find((d) => d.id === "ghost")!;
    expect(ghostDiff.skipped).toBe(true);
    expect(ghostDiff.reason).toContain("no YAML block");

    const part2After = plan.nextConfig.modules!.find((m) => m.id === "part2")!;
    expect(part2After.settings!.closingLine).toBe(
      "I am a manually-edited closing line.",
    );
  });
});

describe("computeBackfillPlan — empty config short-circuit", () => {
  it("returns an empty diff when the Playbook has no modules", () => {
    const config: PlaybookConfig = {};
    const plan = computeBackfillPlan(config, IELTS_V23);
    expect(plan.diffs).toEqual([]);
    expect(plan.nextConfig.modules).toEqual([]);
  });
});
