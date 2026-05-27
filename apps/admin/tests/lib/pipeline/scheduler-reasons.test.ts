import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SCHEDULER_REASONS,
  SCHEDULER_MODE_REASONS,
  reasonForMode,
} from "@/lib/pipeline/scheduler-reasons";
import type { SchedulerMode } from "@/lib/pipeline/scheduler-decision";

/**
 * #923 — scheduler `reason` strings are surfaced to learners via
 * SimProgressPanel ("Today's call" section). The contract:
 *
 *   1. Each reason reads as a complete sentence addressed to the learner.
 *   2. No reason starts with a lowercase log-prefix (e.g. `scheduler:`,
 *      `adapt:`, `reward:`). Regression-test contract:
 *      `/^[a-z][a-z_-]*:\s/` must not match.
 *
 * This file enforces both the constants module AND the writer source files
 * (so a future contributor who inlines a `reason: "scheduler: ..."` string
 * fails the build).
 */

const LOG_PREFIX = /^[a-z][a-z_-]*:\s/;

/** Strings any reasonable reader would call "log jargon, not learner copy". */
const FORBIDDEN_JARGON = [
  "working set",
  "fallback teach mode",
  "scoring allowed",
  "scheduler:",
  "callsSinceAssess",
  "callsSinceLastAssess",
  "retrieval cadence",
];

describe("SCHEDULER_REASONS — constants module (#923)", () => {
  const allReasons: string[] = [
    ...Object.values(SCHEDULER_REASONS),
    ...Object.values(SCHEDULER_MODE_REASONS),
  ];

  it.each(allReasons)("'%s' does not start with a log-style prefix", (reason) => {
    expect(reason).not.toMatch(LOG_PREFIX);
  });

  it.each(allReasons)("'%s' reads as a complete sentence (ends with . or !)", (reason) => {
    // Allow `.`, `!`, or `?` as terminal punctuation. Em-dash mid-sentence is fine.
    expect(reason).toMatch(/[.!?]$/);
  });

  it.each(allReasons)("'%s' is short enough for SimProgressPanel (<= 100 chars)", (reason) => {
    expect(reason.length).toBeLessThanOrEqual(100);
  });

  it.each(allReasons)("'%s' contains no internal jargon", (reason) => {
    const lower = reason.toLowerCase();
    const hits = FORBIDDEN_JARGON.filter((term) => lower.includes(term.toLowerCase()));
    expect(hits).toEqual([]);
  });

  it.each(allReasons)("'%s' contains no parenthesised internal counts", (reason) => {
    // Things like "(0 LOs, 300 TPs)" or "(2/3)" leak internal state to the learner.
    expect(reason).not.toMatch(/\(\s*\d/);
  });

  it("reasonForMode resolves every SchedulerMode", () => {
    const modes: SchedulerMode[] = ["teach", "review", "assess", "practice"];
    for (const m of modes) {
      const r = reasonForMode(m);
      expect(r).toBe(SCHEDULER_MODE_REASONS[m]);
      expect(r).toBeTruthy();
    }
  });
});

describe("scheduler writer sources — no inline log-prefixed reasons (#923)", () => {
  // Static analysis: scan the scheduler writer source files for any
  // `reason: '…'` / `reason: "…"` / `reason: \`…\`` literal that starts with
  // a lowercase log-style prefix. This is the regression contract — if a
  // future change inlines `reason: "scheduler: ..."` again, this test fails.
  const FORBIDDEN_INLINE = /reason\s*:\s*['"`][a-z][a-z_-]*:\s/g;

  // Paths are resolved relative to the apps/admin cwd (vitest is run from
  // apps/admin per the project's `npm run test` script).
  const files = [
    "lib/pipeline/scheduler.ts",
    "lib/pipeline/scheduler-decision.ts",
    "lib/pipeline/scheduler-reasons.ts",
    "lib/prompt/composition/transforms/modules.ts",
  ];

  it.each(files)("%s contains no log-prefixed inline reason literals", (rel) => {
    const abs = path.join(process.cwd(), rel);
    expect(fs.existsSync(abs)).toBe(true);
    const src = fs.readFileSync(abs, "utf-8");
    const matches = src.match(FORBIDDEN_INLINE);
    expect(matches).toBeNull();
  });
});
