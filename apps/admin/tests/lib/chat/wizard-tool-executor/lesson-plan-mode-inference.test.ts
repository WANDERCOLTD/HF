/**
 * Unit tests for the wizard `create_course` config-merge inference of
 * `lessonPlanMode` when modules / course-ref-upload signals are
 * present but the course-ref doesn't explicitly declare a mode.
 *
 * Background: IELTS Speaking Practice on staging shipped with 5
 * authored modules but `Playbook.config.lessonPlanMode` unset → the
 * admin Modules tab default-deny (`courseStyle === "continuous"`)
 * hid the modules. The detector (`lib/wizard/detect-pedagogy.ts`)
 * only ever emits `"continuous"` or `null` — never `"structured"` —
 * so the wizard merge needs to infer "structured" from the canonical
 * authored-course signals available at merge time:
 *
 *   - **New path**: `setupData.coursePedagogy` is non-null (a course-ref
 *     was uploaded + parsed). Absent an explicit `"continuous"` from
 *     the detector, default to `"structured"`.
 *   - **Reuse path**: `existingConfig.modules` is a non-empty array
 *     (authored modules already on the playbook). Default to
 *     `"structured"` so the admin Modules tab surfaces them.
 *
 * The pipeline runtime default-deny convention (`lib/pipeline/course-style.ts`
 * strict `=== "structured"`) is unaffected — this is wizard authoring
 * inference at write time, not a runtime default.
 *
 * Tests pin the 4-cell matrix per merge path:
 *
 *   | Case | pedagogy.lessonPlanMode | modules / pedagogy presence | Expected lessonPlanMode |
 *   |------|-------------------------|------------------------------|--------------------------|
 *   | A    | "structured"            | any                          | "structured" (explicit) |
 *   | B    | "continuous"            | any                          | "continuous" (explicit) |
 *   | C    | undefined               | modules-present / pedagogy   | "structured" (inferred) |
 *   | D    | undefined               | no modules / no pedagogy     | unset (preserved)       |
 */
import { describe, it, expect, vi } from "vitest";

// _new-config-merge.ts dynamically imports the AI guard module; mock it.
vi.mock("@/lib/chat/wizard-ai-output-guard", () => ({
  guardAILearningOutcomes: () => ({
    filtered: [],
    accepted: [],
    skippedByGate: false,
    gateReason: undefined,
  }),
}));

import { buildNewConfigUpdate } from "@/lib/chat/wizard-tool-executor/tools/create_course/_new-config-merge";
import { buildReuseConfigUpdate } from "@/lib/chat/wizard-tool-executor/tools/create_course/_reuse-config-merge";
import type { ResolvedCreateCourseContext } from "@/lib/chat/wizard-tool-executor/tools/create_course/_context";

function newCtx(
  overrides: Partial<{
    input: Record<string, unknown>;
    setupData: Record<string, unknown>;
  }> = {},
): ResolvedCreateCourseContext {
  return {
    input: overrides.input ?? {},
    setupData: overrides.setupData,
    userId: "user-test",
    domainId: "dom-test",
    subjectDiscipline: "IELTS Speaking",
    courseName: "IELTS Speaking Practice",
    interactionPattern: "directive",
  };
}

describe("_new-config-merge — lessonPlanMode inference (IELTS-on-staging fingerprint)", () => {
  it("Case A: explicit pedagogy.lessonPlanMode = 'structured' wins", async () => {
    const ctx = newCtx({
      setupData: {
        coursePedagogy: { lessonPlanMode: "structured" },
      },
    });
    const { configUpdate } = await buildNewConfigUpdate({
      existingConfig: {},
      ctx,
    });
    expect(configUpdate.lessonPlanMode).toBe("structured");
  });

  it("Case B: explicit pedagogy.lessonPlanMode = 'continuous' wins", async () => {
    const ctx = newCtx({
      setupData: {
        coursePedagogy: { lessonPlanMode: "continuous" },
      },
    });
    const { configUpdate } = await buildNewConfigUpdate({
      existingConfig: {},
      ctx,
    });
    expect(configUpdate.lessonPlanMode).toBe("continuous");
  });

  it("Case C: course-ref uploaded (coursePedagogy present) + no explicit mode → defaults to 'structured'", async () => {
    const ctx = newCtx({
      setupData: {
        coursePedagogy: {
          lessonPlanMode: null,
          cadenceMinutesPerCall: null,
          suggestedSessionCount: null,
        },
      },
    });
    const { configUpdate } = await buildNewConfigUpdate({
      existingConfig: {},
      ctx,
    });
    expect(configUpdate.lessonPlanMode).toBe("structured");
  });

  it("Case D: no course-ref + no explicit mode → lessonPlanMode preserved (unset)", async () => {
    const ctx = newCtx({});
    const { configUpdate } = await buildNewConfigUpdate({
      existingConfig: {},
      ctx,
    });
    expect(configUpdate.lessonPlanMode).toBeUndefined();
  });

  it("invalid pedagogy.lessonPlanMode value is dropped (not written)", async () => {
    const ctx = newCtx({
      setupData: {
        coursePedagogy: { lessonPlanMode: "not-a-valid-mode" },
      },
    });
    const { configUpdate } = await buildNewConfigUpdate({
      existingConfig: {},
      ctx,
    });
    // Invalid value rejected; merge falls through. The pedagogy block
    // IS present so the structured-default inference does NOT fire
    // when the explicit-but-invalid branch was taken (the explicit
    // value loses; merge proceeds without setting the field — same
    // shape as the other invalid-enum drops).
    expect(configUpdate.lessonPlanMode).toBeUndefined();
  });
});

describe("_reuse-config-merge — lessonPlanMode inference (IELTS-on-staging fingerprint)", () => {
  it("Case A: explicit pedagogy.lessonPlanMode = 'structured' wins", () => {
    const ctx = newCtx({
      setupData: {
        coursePedagogy: { lessonPlanMode: "structured" },
      },
    });
    const out = buildReuseConfigUpdate({}, ctx);
    expect(out.lessonPlanMode).toBe("structured");
  });

  it("Case B: explicit pedagogy.lessonPlanMode = 'continuous' wins", () => {
    const ctx = newCtx({
      setupData: {
        coursePedagogy: { lessonPlanMode: "continuous" },
      },
    });
    const out = buildReuseConfigUpdate({}, ctx);
    expect(out.lessonPlanMode).toBe("continuous");
  });

  it("Case C: existingConfig.modules non-empty + no explicit mode → defaults to 'structured'", () => {
    const ctx = newCtx({});
    const out = buildReuseConfigUpdate(
      { modules: [{ id: "m1" }, { id: "m2" }] },
      ctx,
    );
    expect(out.lessonPlanMode).toBe("structured");
  });

  it("Case C (alt): course-ref uploaded + no modules-yet → defaults to 'structured'", () => {
    const ctx = newCtx({
      setupData: {
        coursePedagogy: {
          lessonPlanMode: null,
          cadenceMinutesPerCall: null,
        },
      },
    });
    const out = buildReuseConfigUpdate({}, ctx);
    expect(out.lessonPlanMode).toBe("structured");
  });

  it("Case D: no modules + no course-ref + no explicit mode → unset (preserved)", () => {
    const ctx = newCtx({});
    const out = buildReuseConfigUpdate({}, ctx);
    expect(out.lessonPlanMode).toBeUndefined();
  });

  it("invalid pedagogy.lessonPlanMode value is dropped (not written)", () => {
    const ctx = newCtx({
      setupData: {
        coursePedagogy: { lessonPlanMode: "garbage-value" },
      },
    });
    const out = buildReuseConfigUpdate({}, ctx);
    expect(out.lessonPlanMode).toBeUndefined();
  });

  it("preserves existing lessonPlanMode when no override is supplied", () => {
    const ctx = newCtx({});
    const out = buildReuseConfigUpdate(
      { lessonPlanMode: "continuous" },
      ctx,
    );
    // existingConfig is spread first; no pedagogy override + no
    // inference branch taken (existing already set). Pass-through.
    expect(out.lessonPlanMode).toBe("continuous");
  });
});

describe("isLessonPlanMode type guard (resolve-config.ts)", () => {
  it("accepts the two canonical values + rejects everything else", async () => {
    const { isLessonPlanMode } = await import(
      "@/lib/content-trust/resolve-config"
    );
    expect(isLessonPlanMode("structured")).toBe(true);
    expect(isLessonPlanMode("continuous")).toBe(true);

    // Cross-union "wrong column" samples — these must NOT pass.
    expect(isLessonPlanMode("recall")).toBe(false); // teachingMode
    expect(isLessonPlanMode("directive")).toBe(false); // interactionPattern
    expect(isLessonPlanMode("breadth")).toBe(false); // planEmphasis
    expect(isLessonPlanMode("5e")).toBe(false); // lessonPlanModel
    expect(isLessonPlanMode("primary")).toBe(false); // audience

    // Garbage rejections.
    expect(isLessonPlanMode(undefined)).toBe(false);
    expect(isLessonPlanMode(null)).toBe(false);
    expect(isLessonPlanMode(123)).toBe(false);
    expect(isLessonPlanMode({})).toBe(false);
    expect(isLessonPlanMode([])).toBe(false);
    expect(isLessonPlanMode("")).toBe(false);
  });
});

describe("detect-pedagogy STRUCTURED_PHRASES (course-ref author surface)", () => {
  it("emits 'structured' when the doc declares `lessonPlanMode: structured`", async () => {
    const { detectPedagogy } = await import("@/lib/wizard/detect-pedagogy");
    const out = detectPedagogy(
      "Some prose. **lessonPlanMode:** structured. More prose.",
    );
    expect(out.lessonPlanMode).toBe("structured");
    expect(out.detectedFrom.some((s) => s.startsWith("structured:"))).toBe(
      true,
    );
  });

  it("emits 'structured' when the doc says 'authored modules'", async () => {
    const { detectPedagogy } = await import("@/lib/wizard/detect-pedagogy");
    const out = detectPedagogy(
      "**Modules authored:** Yes — see `## Modules` below.",
    );
    expect(out.lessonPlanMode).toBe("structured");
  });

  it("structured signal overrides short-cadence → continuous inference", async () => {
    const { detectPedagogy } = await import("@/lib/wizard/detect-pedagogy");
    const out = detectPedagogy(
      "**lessonPlanMode:** structured. Call duration: 15 minutes.",
    );
    // Cadence is short (15 min) so the legacy fallback would have set
    // "continuous" — but the explicit structured marker wins.
    expect(out.lessonPlanMode).toBe("structured");
    expect(out.cadenceMinutesPerCall).toBe(15);
  });

  it("preserves 'continuous' detection when no structured marker is present", async () => {
    const { detectPedagogy } = await import("@/lib/wizard/detect-pedagogy");
    const out = detectPedagogy(
      "The scheduler decides per call. No fixed session plan.",
    );
    expect(out.lessonPlanMode).toBe("continuous");
  });
});
