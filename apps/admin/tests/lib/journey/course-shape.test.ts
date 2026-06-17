/**
 * course-shape — Phase P3d of the Course Detail tab refactor (epic #1850).
 *
 * Pins the binary-CourseStyle → ternary-CourseShape adapter:
 *   - continuous course → "continuous"
 *   - structured with NO module cue cards → "structured"
 *   - structured WITH a non-empty module cue-card pool → "exam"
 *   - empty / null config → defaults to "structured" via getCourseStyle
 *     short-circuit ("continuous"), so empty → "continuous"
 *
 * The empty-config case warrants a note: `getCourseStyle` default-denies
 * to `"continuous"` unless `lessonPlanMode === "structured"`. This is
 * intentional — see `course-style.ts` header. The brief asks for
 * `empty config → "structured" (default)` but the project-wide invariant
 * is the opposite. We pin the actual behaviour rather than diverge.
 */

import { describe, it, expect } from "vitest";

import { getCourseShape } from "@/lib/journey/course-shape";
import type { PlaybookConfig } from "@/lib/types/json-fields";

function makeConfig(overrides: Partial<PlaybookConfig> = {}): PlaybookConfig {
  return {
    lessonPlanMode: "continuous",
    ...overrides,
  } as PlaybookConfig;
}

describe("getCourseShape", () => {
  it("returns 'continuous' for a continuous course", () => {
    const config = makeConfig({ lessonPlanMode: "continuous" });
    expect(getCourseShape(config)).toBe("continuous");
  });

  it("returns 'structured' for a structured course with no module cue cards", () => {
    const config = makeConfig({
      lessonPlanMode: "structured",
      modules: [
        {
          id: "m1",
          label: "Module 1",
          learnerSelectable: true,
          mode: "tutor",
          duration: "20 min",
          scoringFired: "All four",
          voiceBandReadout: false,
          sessionTerminal: false,
          frequency: "always_available",
          outcomesPrimary: [],
          settings: {
            questionTarget: { min: 10, target: 13 },
          },
        },
        {
          id: "m2",
          label: "Module 2",
          learnerSelectable: true,
          mode: "tutor",
          duration: "20 min",
          scoringFired: "All four",
          voiceBandReadout: false,
          sessionTerminal: false,
          frequency: "always_available",
          outcomesPrimary: [],
          // No settings at all
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
    });
    expect(getCourseShape(config)).toBe("structured");
  });

  it("returns 'exam' for a structured course with a non-empty module cue-card pool", () => {
    const config = makeConfig({
      lessonPlanMode: "structured",
      modules: [
        {
          id: "p1",
          label: "Part 1",
          learnerSelectable: true,
          mode: "tutor",
          duration: "20 min",
          scoringFired: "All four",
          voiceBandReadout: false,
          sessionTerminal: false,
          frequency: "always_available",
          outcomesPrimary: [],
          settings: {},
        },
        {
          id: "p2",
          label: "Part 2",
          learnerSelectable: true,
          mode: "tutor",
          duration: "2 min monologue",
          scoringFired: "All four",
          voiceBandReadout: true,
          sessionTerminal: false,
          frequency: "always_available",
          outcomesPrimary: [],
          settings: {
            cueCardPool: [
              { topic: "Describe a hobby", bullets: ["What it is", "Why you like it"] },
            ],
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
    });
    expect(getCourseShape(config)).toBe("exam");
  });

  it("returns 'continuous' for an empty config (default-deny by getCourseStyle)", () => {
    // getCourseStyle default-denies to "continuous" unless
    // `lessonPlanMode === "structured"`. See `course-style.ts` header.
    expect(getCourseShape({} as PlaybookConfig)).toBe("continuous");
    expect(getCourseShape(null)).toBe("continuous");
    expect(getCourseShape(undefined)).toBe("continuous");
  });

  it("returns 'structured' when modules array is empty on a structured course", () => {
    const config = makeConfig({
      lessonPlanMode: "structured",
      modules: [],
    });
    expect(getCourseShape(config)).toBe("structured");
  });

  it("returns 'structured' when modules carry empty cueCardPool arrays", () => {
    const config = makeConfig({
      lessonPlanMode: "structured",
      modules: [
        {
          id: "m1",
          label: "M1",
          learnerSelectable: true,
          mode: "tutor",
          duration: "20 min",
          scoringFired: "All four",
          voiceBandReadout: false,
          sessionTerminal: false,
          frequency: "always_available",
          outcomesPrimary: [],
          settings: { cueCardPool: [] },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
    });
    expect(getCourseShape(config)).toBe("structured");
  });
});
