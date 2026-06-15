/**
 * Phase 6 (#1708) regression: voiceFlow lens retired from Design tab.
 *
 * Asserts on the file contents to catch any future re-introduction.
 * The runtime contract: no `voiceFlow` lens id, no VoiceFlowLens import.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const CONSOLE_PATH = join(
  REPO_ROOT,
  "app/x/courses/[courseId]/_components/CourseDesignConsole.tsx",
);
const VFL_TSX = join(
  REPO_ROOT,
  "app/x/courses/[courseId]/_components/VoiceFlowLens.tsx",
);
const VFL_CSS = join(
  REPO_ROOT,
  "app/x/courses/[courseId]/_components/voice-flow-lens.css",
);

describe("voiceFlow lens retirement — Phase 6 (#1708)", () => {
  const consoleSrc = readFileSync(CONSOLE_PATH, "utf-8");

  it("VoiceFlowLens.tsx no longer exists", () => {
    expect(existsSync(VFL_TSX)).toBe(false);
  });

  it("voice-flow-lens.css no longer exists", () => {
    expect(existsSync(VFL_CSS)).toBe(false);
  });

  it("DesignLensId union no longer includes 'voiceFlow'", () => {
    // The type union has been narrowed; the only remaining matches are
    // in the retirement comments. Assert no live `| "voiceFlow"` line.
    const liveUnionLines = consoleSrc
      .split("\n")
      .filter((l) => /\|\s*"voiceFlow"/.test(l));
    expect(liveUnionLines).toEqual([]);
  });

  it("DESIGN_LENS_ORDER no longer contains the voiceFlow string literal", () => {
    // The ORDER array is rendered as a multi-line list of string entries.
    // Assert there's no `"voiceFlow",` row.
    expect(consoleSrc).not.toMatch(/^\s*"voiceFlow",\s*$/m);
  });

  it("CourseDesignConsole no longer imports VoiceFlowLens", () => {
    expect(consoleSrc).not.toMatch(/from\s+["']\.\/VoiceFlowLens["']/);
    expect(consoleSrc).not.toMatch(/import.*VoiceFlowLens/);
  });
});
