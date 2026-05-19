/**
 * Tests for `readModuleFlags()` in `lib/curriculum/course-completion.ts`
 * (#494 E2 Slice 2.4).
 *
 * Covers defaulting behaviour for the four per-module progression fields
 * provisioned in this slice:
 *   - `prerequisites`     (String[])  default []
 *   - `terminal`          (Boolean)   default false
 *   - `coversModules`     (String[])  default []
 *   - `masteryThreshold`  (Float?)    default = playbook-level (0.7)
 *
 * Both the Prisma `CurriculumModule` row and the `AuthoredModule` JSON
 * shape satisfy the `ReadableModuleFlags` input — this helper is the
 * single read-site so downstream callers (recommend-module, picker,
 * isCourseComplete) share one default story.
 */

import { describe, it, expect } from "vitest";

import {
  DEFAULT_MASTERY_THRESHOLD,
  readModuleFlags,
} from "@/lib/curriculum/course-completion";

describe("readModuleFlags", () => {
  it("returns defaults when every field is null", () => {
    expect(
      readModuleFlags({
        prerequisites: null,
        terminal: null,
        coversModules: null,
        masteryThreshold: null,
      }),
    ).toEqual({
      prerequisites: [],
      terminal: false,
      coversModules: [],
      masteryThreshold: 0.7,
    });
  });

  it("returns defaults when every field is undefined", () => {
    expect(readModuleFlags({})).toEqual({
      prerequisites: [],
      terminal: false,
      coversModules: [],
      masteryThreshold: 0.7,
    });
  });

  it("passes through empty arrays unchanged", () => {
    expect(
      readModuleFlags({
        prerequisites: [],
        terminal: false,
        coversModules: [],
        masteryThreshold: null,
      }),
    ).toEqual({
      prerequisites: [],
      terminal: false,
      coversModules: [],
      masteryThreshold: 0.7,
    });
  });

  it("passes filled prerequisites + coversModules verbatim", () => {
    const flags = readModuleFlags({
      prerequisites: ["part1", "part2"],
      terminal: true,
      coversModules: ["part1", "part2", "part3"],
      masteryThreshold: 0.85,
    });
    expect(flags).toEqual({
      prerequisites: ["part1", "part2"],
      terminal: true,
      coversModules: ["part1", "part2", "part3"],
      masteryThreshold: 0.85,
    });
  });

  it("falls back to playbook-level default when masteryThreshold is null", () => {
    expect(
      readModuleFlags(
        { masteryThreshold: null },
        0.8, // playbook-level override
      ).masteryThreshold,
    ).toBe(0.8);
  });

  it("falls back to playbook-level default when masteryThreshold is undefined", () => {
    expect(readModuleFlags({}, 0.65).masteryThreshold).toBe(0.65);
  });

  it("falls back to function-level 0.7 when no playbook default is passed", () => {
    expect(readModuleFlags({}).masteryThreshold).toBe(
      DEFAULT_MASTERY_THRESHOLD,
    );
    expect(DEFAULT_MASTERY_THRESHOLD).toBe(0.7);
  });

  it("returns the module's masteryThreshold verbatim when set, ignoring playbook default", () => {
    expect(
      readModuleFlags({ masteryThreshold: 0.55 }, 0.9).masteryThreshold,
    ).toBe(0.55);
  });

  it("treats a non-array prerequisites value as []", () => {
    // Defensive: legacy / hand-edited JSON could leak a non-array through
    // the `as any` casts in some call sites. The reader must not propagate
    // garbage downstream.
    const flags = readModuleFlags({
      prerequisites: "part1" as unknown as string[],
    });
    expect(flags.prerequisites).toEqual([]);
  });

  it("treats a non-array coversModules value as []", () => {
    const flags = readModuleFlags({
      coversModules: { 0: "part1" } as unknown as string[],
    });
    expect(flags.coversModules).toEqual([]);
  });

  it("treats a non-boolean terminal as false", () => {
    const flags = readModuleFlags({
      terminal: "true" as unknown as boolean,
    });
    expect(flags.terminal).toBe(false);
  });

  it("accepts a Prisma-style row shape (extra fields ignored)", () => {
    // Sanity check: the helper's `ReadableModuleFlags` shape is loose enough
    // that a real CurriculumModule row passes through with only the four
    // relevant fields read.
    const moduleRow = {
      id: "abc",
      curriculumId: "cur-1",
      slug: "part2",
      title: "Part 2",
      prerequisites: ["part1"],
      terminal: false,
      coversModules: [],
      masteryThreshold: 0.75,
    };
    expect(readModuleFlags(moduleRow)).toEqual({
      prerequisites: ["part1"],
      terminal: false,
      coversModules: [],
      masteryThreshold: 0.75,
    });
  });
});
