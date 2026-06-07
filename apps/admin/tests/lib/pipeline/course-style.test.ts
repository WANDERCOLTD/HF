import { describe, expect, test } from "vitest";
import { getCourseStyle } from "@/lib/pipeline/course-style";
import type { PlaybookConfig } from "@/lib/types/json-fields";

describe("getCourseStyle — default-deny resolution (#1253)", () => {
  test("explicit lessonPlanMode='structured' → 'structured'", () => {
    expect(getCourseStyle({ lessonPlanMode: "structured" })).toBe("structured");
  });

  test("explicit lessonPlanMode='continuous' → 'continuous'", () => {
    expect(getCourseStyle({ lessonPlanMode: "continuous" })).toBe("continuous");
  });

  test("undefined config → 'continuous' (default-deny)", () => {
    expect(getCourseStyle(undefined)).toBe("continuous");
  });

  test("null config → 'continuous' (default-deny)", () => {
    expect(getCourseStyle(null)).toBe("continuous");
  });

  test("empty config {} → 'continuous' (default-deny)", () => {
    expect(getCourseStyle({})).toBe("continuous");
  });

  test("modulesAuthored: true alone does NOT imply 'structured'", () => {
    // Load-bearing test — proves we do not infer from modulesAuthored.
    // Old playbooks with `modulesAuthored: true` but no `lessonPlanMode`
    // are CONTINUOUS until re-published.
    const config = { modulesAuthored: true } as unknown as PlaybookConfig;
    expect(getCourseStyle(config)).toBe("continuous");
  });
});
