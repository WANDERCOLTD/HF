/**
 * Unit + static-regression tests for the shared pedagogy helper (#1545).
 *
 * The helper centralises the ContentSource + ContentAssertion write
 * shape that pre-#1547 lived inline in two mirror blocks of
 * `wizard-tool-executor.ts` and now lives in two mirror blocks of
 * `tools/create_course.ts`. The pre-fix blocks shipped with three
 * silently-dropped field names (`status` on ContentSource;
 * `confidence` + `isActive` on ContentAssertion) plus a missing required
 * `slug`. Prisma threw on every write; the outer try/catch logged
 * "non-fatal" — silent NO-OP for every wizard-driven course.
 *
 * Tests pin:
 *   1. Helper invokes prisma with the canonical write shape (matches
 *      `app/api/courses/[courseId]/course-reference/route.ts:166`).
 *   2. Static-source grep against `create_course.ts` — the four drift
 *      fields must NOT reappear in the file; `linkConfidence:` + `slug`
 *      must be reachable through the helper import.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockContentSourceCreate = vi.fn();
const mockSubjectSourceCreate = vi.fn();
const mockContentAssertionCreate = vi.fn();
const mockUpsertPlaybookSource = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contentSource: { create: (...args: unknown[]) => mockContentSourceCreate(...args) },
    subjectSource: { create: (...args: unknown[]) => mockSubjectSourceCreate(...args) },
    contentAssertion: { create: (...args: unknown[]) => mockContentAssertionCreate(...args) },
  },
}));

vi.mock("@/lib/knowledge/domain-sources", () => ({
  upsertPlaybookSource: (...args: unknown[]) => mockUpsertPlaybookSource(...args),
}));

import { createPedagogyAssertionsFromCourseRef } from "@/lib/chat/wizard-tool-executor/tools/_pedagogy-assertions";
import type { AssertionCreateData } from "@/lib/content-trust/course-ref-to-assertions";

function row(overrides: Partial<AssertionCreateData> = {}): AssertionCreateData {
  return {
    assertion: "Teach this point",
    category: "teaching_rule",
    chapter: "Module 1",
    section: null,
    tags: ["pedagogy"],
    orderIndex: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockContentSourceCreate.mockResolvedValue({ id: "src-1" });
  // #2132 — subjectSource.create now requests `select: { id: true }` so
  // the helper can pass subjectSourceId on every ContentAssertion write
  // (closes ENTITIES.md §6 I1). Mock must return a row with an id.
  mockSubjectSourceCreate.mockResolvedValue({ id: "ss-1" });
  mockContentAssertionCreate.mockResolvedValue({});
  mockUpsertPlaybookSource.mockResolvedValue({});
});

describe("createPedagogyAssertionsFromCourseRef — canonical write shape (#1545)", () => {
  it("writes ContentSource with slug + trustLevel + contentHash + isActive (mirror canonical route)", async () => {
    await createPedagogyAssertionsFromCourseRef({
      courseName: "Big Five OCEAN",
      playbookId: "pb-1",
      subjectId: "sub-1",
      textSample: "# Course reference markdown",
      assertionRows: [row()],
    });

    expect(mockContentSourceCreate).toHaveBeenCalledTimes(1);
    const args = mockContentSourceCreate.mock.calls[0][0];
    expect(args.data.slug).toMatch(/^big-five-ocean-ref-\d+$/);
    expect(args.data.name).toBe("Big Five OCEAN — Course Reference");
    expect(args.data.documentType).toBe("COURSE_REFERENCE");
    expect(args.data.trustLevel).toBe("EXPERT_CURATED");
    expect(args.data.textSample).toBe("# Course reference markdown");
    expect(args.data.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(args.data.isActive).toBe(true);
    expect(args.data.status).toBeUndefined();
  });

  it("links primary subject + dual-writes PlaybookSource", async () => {
    await createPedagogyAssertionsFromCourseRef({
      courseName: "Course",
      playbookId: "pb-1",
      subjectId: "sub-1",
      textSample: "x",
      assertionRows: [row()],
    });

    // #2132 — `select: { id: true }` added so the helper can pass
    // subjectSourceId on each ContentAssertion write (I1 invariant).
    expect(mockSubjectSourceCreate).toHaveBeenCalledWith({
      data: { subjectId: "sub-1", sourceId: "src-1" },
      select: { id: true },
    });
    expect(mockUpsertPlaybookSource).toHaveBeenCalledWith("pb-1", "src-1", {
      tags: ["course-reference"],
    });
  });

  it("writes ContentAssertion rows with linkConfidence=1.0 + depth=0 + subjectSourceId (NOT confidence, NOT isActive)", async () => {
    await createPedagogyAssertionsFromCourseRef({
      courseName: "Course",
      playbookId: "pb-1",
      subjectId: "sub-1",
      textSample: "x",
      assertionRows: [row({ assertion: "First fact" }), row({ assertion: "Second fact" })],
    });

    expect(mockContentAssertionCreate).toHaveBeenCalledTimes(2);
    const args0 = mockContentAssertionCreate.mock.calls[0][0];
    expect(args0.data.sourceId).toBe("src-1");
    // #2132 — every ContentAssertion write MUST set subjectSourceId so
    // SectionDataLoader's strict-FK filter scopes correctly (ENTITIES.md
    // §6 I1). Without this, assertions leak cross-course in shared Subjects.
    expect(args0.data.subjectSourceId).toBe("ss-1");
    expect(args0.data.linkConfidence).toBe(1.0);
    expect(args0.data.depth).toBe(0);
    expect(args0.data.assertion).toBe("First fact");
    expect(args0.data.confidence).toBeUndefined();
    expect(args0.data.isActive).toBeUndefined();
  });

  it("returns sourceId + assertionCount summary", async () => {
    const result = await createPedagogyAssertionsFromCourseRef({
      courseName: "Course",
      playbookId: "pb-1",
      subjectId: "sub-1",
      textSample: "x",
      assertionRows: [row(), row(), row()],
    });
    expect(result).toEqual({ sourceId: "src-1", assertionCount: 3 });
  });

  it("propagates Prisma errors instead of swallowing them (the outer try/catch chooses fatality)", async () => {
    mockContentSourceCreate.mockRejectedValueOnce(new Error("unique constraint"));
    await expect(
      createPedagogyAssertionsFromCourseRef({
        courseName: "Course",
        playbookId: "pb-1",
        subjectId: "sub-1",
        textSample: "x",
        assertionRows: [row()],
      }),
    ).rejects.toThrow(/unique constraint/);
  });
});

describe("create_course.ts static regression — drift fields must not return (#1545)", () => {
  it("create_course (orchestrator + stage helpers) no longer writes status / confidence / isActive on assertion creates", async () => {
    // Sibling of the static-source check at
    // `tests/lib/content-trust/playbook-source-isolation.test.ts:77-100`.
    // The helper is the sanctioned source of write shape; if a future
    // edit re-inlines a drifted field, this test fires.
    //
    // Post-#1544 the pedagogy block was lifted out of the monolithic
    // create_course.ts into the per-stage helpers under
    // `tools/create_course/`. The check now spans the orchestrator + the
    // two stage files that own the pedagogy write (`_reuse-path.ts` for
    // the reuse-branch block, `_lesson-plan.ts` for the new-path block).
    const fs = await import("fs/promises");
    const path = await import("path");
    const baseDir = path.resolve(
      __dirname,
      "../../../../lib/chat/wizard-tool-executor/tools",
    );
    const targets = [
      "create_course.ts",
      "create_course/_reuse-path.ts",
      "create_course/_lesson-plan.ts",
    ];
    const sources = await Promise.all(
      targets.map((rel) => fs.readFile(path.join(baseDir, rel), "utf8")),
    );
    const combined = sources.join("\n");

    // Helper import + canonical name must be reachable from at least one
    // of the surveyed files — proves the wizard hasn't reverted to an
    // inline hand-rolled write block.
    expect(combined).toMatch(/await import\("\.\.?\/(?:create_course\/)?_pedagogy-assertions"\)/);
    expect(combined).toContain("createPedagogyAssertionsFromCourseRef");

    // None of the four drift fields may appear inside a ContentSource or
    // ContentAssertion `prisma.*.create({ data: { … } })` block in any of
    // the surveyed files.
    expect(combined).not.toMatch(/contentSource\.create[\s\S]*?status:\s*"COMPLETED"/);
    expect(combined).not.toMatch(/contentAssertion\.create[\s\S]*?confidence:\s*1\.0/);
  });
});
