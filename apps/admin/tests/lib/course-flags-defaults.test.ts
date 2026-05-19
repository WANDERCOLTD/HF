/**
 * Tests for `lib/curriculum/course-completion.ts` (#494 E2 Slice 2.3).
 *
 * Covers `readCourseFlags()` defaulting behaviour:
 *   - empty / null / undefined config → defaults
 *   - explicit values → returned verbatim
 *   - partial config (one flag set) → other gets default
 *   - invalid completionMode → defaults to terminal-only
 *
 * The helper is the single read-site for these flags; the downstream
 * picker (Slice 2.5) and isCourseComplete predicate (Slice 2.7) call
 * through it, so the default semantics are load-bearing.
 */

import { describe, it, expect } from "vitest";

import type { PlaybookConfig } from "@/lib/types/json-fields";
import {
  COMPLETION_MODES,
  DEFAULT_COMPLETION_MODE,
  DEFAULT_STRICT_PREREQUISITES,
  readCourseFlags,
} from "@/lib/curriculum/course-completion";

describe("readCourseFlags", () => {
  it("returns defaults for null config", () => {
    expect(readCourseFlags(null)).toEqual({
      strictPrerequisites: DEFAULT_STRICT_PREREQUISITES,
      completionMode: DEFAULT_COMPLETION_MODE,
    });
  });

  it("returns defaults for undefined config", () => {
    expect(readCourseFlags(undefined)).toEqual({
      strictPrerequisites: false,
      completionMode: "terminal-only",
    });
  });

  it("returns defaults for empty config", () => {
    expect(readCourseFlags({} as PlaybookConfig)).toEqual({
      strictPrerequisites: false,
      completionMode: "terminal-only",
    });
  });

  it("returns explicit values verbatim", () => {
    const config = {
      strictPrerequisites: true,
      completionMode: "all-modules",
    } as PlaybookConfig;
    expect(readCourseFlags(config)).toEqual({
      strictPrerequisites: true,
      completionMode: "all-modules",
    });
  });

  it("backfills completionMode when only strictPrerequisites is set", () => {
    const config = { strictPrerequisites: true } as PlaybookConfig;
    expect(readCourseFlags(config)).toEqual({
      strictPrerequisites: true,
      completionMode: "terminal-only",
    });
  });

  it("backfills strictPrerequisites when only completionMode is set", () => {
    const config = { completionMode: "any" } as PlaybookConfig;
    expect(readCourseFlags(config)).toEqual({
      strictPrerequisites: false,
      completionMode: "any",
    });
  });

  it("defaults to terminal-only when completionMode is an unknown string", () => {
    // Legacy data or hand-edited row: a value outside the enum should be
    // treated as if the field were absent, NOT propagated downstream.
    const config = {
      completionMode: "nonsense-mode",
    } as unknown as PlaybookConfig;
    expect(readCourseFlags(config)).toEqual({
      strictPrerequisites: false,
      completionMode: "terminal-only",
    });
  });

  it("defaults to false when strictPrerequisites is a non-boolean", () => {
    // Defensive: AI / wizard could in theory write a string here; we
    // refuse to coerce and fall back to the safe default.
    const config = {
      strictPrerequisites: "true",
    } as unknown as PlaybookConfig;
    expect(readCourseFlags(config)).toEqual({
      strictPrerequisites: false,
      completionMode: "terminal-only",
    });
  });

  it("accepts every value in COMPLETION_MODES", () => {
    for (const mode of COMPLETION_MODES) {
      const config = { completionMode: mode } as PlaybookConfig;
      expect(readCourseFlags(config).completionMode).toBe(mode);
    }
  });

  it("exposes default constants matching the runtime defaults", () => {
    expect(DEFAULT_STRICT_PREREQUISITES).toBe(false);
    expect(DEFAULT_COMPLETION_MODE).toBe("terminal-only");
  });
});
