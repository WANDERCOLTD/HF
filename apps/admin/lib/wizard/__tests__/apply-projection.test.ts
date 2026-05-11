import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeConfig } from "../apply-projection";
import { projectCourseReference } from "../project-course-reference";
import type { CourseProjection } from "../project-course-reference";
import type { GoalTemplate, PlaybookConfig } from "@/lib/types/json-fields";

const FIXTURES = join(__dirname, "fixtures");
const IELTS_V22 = readFileSync(join(FIXTURES, "course-reference-ielts-v2.2.md"), "utf-8");
const SOURCE_ID_A = "src-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SOURCE_ID_B = "src-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const ieltsProjection = (id = SOURCE_ID_A): CourseProjection =>
  projectCourseReference(IELTS_V22, { sourceContentId: id });

// ── mergeConfig — goal-template policy ────────────────────────────────────

describe("mergeConfig — goal template policy", () => {
  it("writes new projection-tagged goal templates onto an empty config", () => {
    const projection = ieltsProjection();
    const result = mergeConfig({}, projection, SOURCE_ID_A);
    expect(result.merged.goals).toBeDefined();
    expect(result.merged.goals!.length).toBe(projection.configPatch.goalTemplates.length);
    expect(result.merged.goals!.every((g) => g.sourceContentId === SOURCE_ID_A)).toBe(true);
  });

  it("preserves hand-authored goals (no sourceContentId tag)", () => {
    const existing: PlaybookConfig = {
      goals: [
        { type: "LEARN", name: "Hand-authored goal", priority: 5 } as GoalTemplate,
      ],
    };
    const projection = ieltsProjection();
    const result = mergeConfig(existing, projection, SOURCE_ID_A);
    expect(result.merged.goals!.some((g) => g.name === "Hand-authored goal")).toBe(true);
  });

  it("preserves goals from a DIFFERENT source on re-apply", () => {
    // Start with goals tagged by source B
    const existing: PlaybookConfig = {
      goals: [
        { type: "LEARN", name: "From source B", sourceContentId: SOURCE_ID_B, ref: "OUT-99" } as GoalTemplate,
      ],
    };
    const projection = ieltsProjection(SOURCE_ID_A);
    const result = mergeConfig(existing, projection, SOURCE_ID_A);
    // Source B's goal survives; A's goals are added on top.
    expect(result.merged.goals!.some((g) => g.name === "From source B" && g.sourceContentId === SOURCE_ID_B)).toBe(true);
    expect(result.merged.goals!.some((g) => g.sourceContentId === SOURCE_ID_A)).toBe(true);
  });

  it("replaces stale projection-tagged goals with current projection (no dupes on re-apply)", () => {
    const projection = ieltsProjection();
    const firstApply = mergeConfig({}, projection, SOURCE_ID_A);
    const secondApply = mergeConfig(firstApply.merged, projection, SOURCE_ID_A);
    // After re-apply, the count of source-A-tagged goals is exactly the projection's count.
    const taggedCount = secondApply.merged.goals!.filter((g) => g.sourceContentId === SOURCE_ID_A).length;
    expect(taggedCount).toBe(projection.configPatch.goalTemplates.length);
  });

  it("removes stale templates when the projection drops them", () => {
    // First apply with full projection
    const fullProjection = ieltsProjection();
    const afterFirst = mergeConfig({}, fullProjection, SOURCE_ID_A);
    const initialCount = afterFirst.merged.goals!.length;
    expect(initialCount).toBeGreaterThan(2);

    // Simulate a reduced projection: only the first 2 templates
    const reduced: CourseProjection = {
      ...fullProjection,
      configPatch: {
        ...fullProjection.configPatch,
        goalTemplates: fullProjection.configPatch.goalTemplates.slice(0, 2),
      },
    };
    const afterSecond = mergeConfig(afterFirst.merged, reduced, SOURCE_ID_A);
    expect(afterSecond.merged.goals!.length).toBe(2);
  });

  it("tags every projection-derived goal template with sourceContentId and ref", () => {
    const projection = ieltsProjection();
    const result = mergeConfig({}, projection, SOURCE_ID_A);
    for (const g of result.merged.goals!) {
      expect(g.sourceContentId).toBe(SOURCE_ID_A);
      expect(g.ref).toMatch(/^(OUT|SKILL)-\d+$/);
    }
  });
});

// ── mergeConfig — projection-owned config fields ──────────────────────────

describe("mergeConfig — config patch", () => {
  it("copies modules, outcomes, progressionMode onto existing config", () => {
    const projection = ieltsProjection();
    const result = mergeConfig({}, projection, SOURCE_ID_A);
    expect(result.merged.modules).toEqual(projection.configPatch.modules);
    expect(result.merged.outcomes).toEqual(projection.configPatch.outcomes);
    expect(result.merged.progressionMode).toBe(projection.configPatch.progressionMode);
    expect(result.merged.modulesAuthored).toBe(true);
    expect(result.merged.moduleSource).toBe("authored");
  });

  it("preserves unrelated config fields (welcome, nps, surveys)", () => {
    const existing: PlaybookConfig = {
      welcome: { goals: { enabled: true } } as PlaybookConfig["welcome"],
      nps: { enabled: true, trigger: "mastery", threshold: 80 } as PlaybookConfig["nps"],
    };
    const projection = ieltsProjection();
    const result = mergeConfig(existing, projection, SOURCE_ID_A);
    expect(result.merged.welcome).toEqual(existing.welcome);
    expect(result.merged.nps).toEqual(existing.nps);
  });

  it("does NOT clobber projection fields when a patch field is undefined", () => {
    const existing: PlaybookConfig = {
      outcomes: { "OUT-99": "Previously authored outcome" },
    };
    // Build a projection with empty configPatch.outcomes
    const projection = projectCourseReference("", { sourceContentId: SOURCE_ID_A });
    const result = mergeConfig(existing, projection, SOURCE_ID_A);
    // outcomes from the existing config should survive because projection's
    // outcomes is undefined (empty doc).
    expect(result.merged.outcomes).toEqual({ "OUT-99": "Previously authored outcome" });
  });
});

// ── applyProjection — mocked prisma smoke test ─────────────────────────────

const PLAYBOOK_ID = "pb-test-00000000-0000-0000-0000-000000000000";
const CURRICULUM_ID = "cur-test-0000";

function buildMockPrisma() {
  return {
    parameter: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ parameterId: "skill_x" }),
    },
    behaviorTarget: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    curriculum: {
      findFirst: vi.fn().mockResolvedValue({ id: CURRICULUM_ID }),
      create: vi.fn().mockResolvedValue({ id: CURRICULUM_ID }),
    },
    curriculumModule: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    playbook: {
      findUnique: vi.fn().mockResolvedValue({ config: {} }),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({} as Record<string, unknown>, {
    get: (_target, prop: string) => mockTx[prop as keyof typeof mockTx],
  }),
}));

let mockTx: ReturnType<typeof buildMockPrisma>;

beforeEach(() => {
  mockTx = buildMockPrisma();
  // $transaction runs the callback synchronously with the same mock as tx.
  mockTx.$transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));
});

describe("applyProjection — orchestrator smoke", () => {
  it("creates 4 parameters, 4 behaviorTargets, 5 curriculumModules on first apply against empty DB", async () => {
    // Dynamic import so the mock is applied
    const { applyProjection } = await import("../apply-projection");
    const projection = ieltsProjection();
    const result = await applyProjection(projection, {
      playbookId: PLAYBOOK_ID,
      sourceContentId: SOURCE_ID_A,
    });

    expect(mockTx.parameter.create).toHaveBeenCalledTimes(4);
    expect(mockTx.behaviorTarget.create).toHaveBeenCalledTimes(4);
    expect(mockTx.curriculumModule.create).toHaveBeenCalledTimes(5);
    expect(mockTx.playbook.update).toHaveBeenCalledTimes(1);

    expect(result.parametersUpserted).toBe(4);
    expect(result.behaviorTargetsCreated).toBe(4);
    expect(result.curriculumModulesCreated).toBe(5);
    expect(result.goalTemplatesWritten).toBe(projection.configPatch.goalTemplates.length);
  });

  it("re-running with all DB rows already present is a no-op (no creates, no deletes)", async () => {
    // Pre-populate the mock to simulate the rows already existing.
    const projection = ieltsProjection();
    const paramIds = projection.parameters.map((p) => p.name);
    const moduleSlugs = projection.curriculumModules.map((m) => m.slug);

    mockTx.parameter.findUnique.mockImplementation(async ({ where }: { where: { parameterId: string } }) =>
      paramIds.includes(where.parameterId) ? { parameterId: where.parameterId } : null,
    );
    mockTx.behaviorTarget.findMany.mockResolvedValue(
      projection.behaviorTargets.map((t) => ({
        id: `bt-${t.parameterName}`,
        parameterId: t.parameterName,
        targetValue: t.targetValue,
      })),
    );
    mockTx.curriculumModule.findMany.mockResolvedValue(
      projection.curriculumModules.map((m) => ({
        id: `cm-${m.slug}`,
        slug: m.slug,
        title: m.title,
        sortOrder: m.sortOrder,
        estimatedDurationMinutes: m.estimatedDurationMinutes ?? null,
      })),
    );
    // Existing config already has the projection's goal templates tagged.
    mockTx.playbook.findUnique.mockResolvedValue({
      config: {
        goals: projection.configPatch.goalTemplates.map((g) => ({
          type: g.type,
          name: g.name,
          description: g.description,
          isAssessmentTarget: g.isAssessmentTarget,
          priority: g.priority,
          sourceContentId: SOURCE_ID_A,
          ref: g.ref,
        })),
      },
    });

    const { applyProjection } = await import("../apply-projection");
    const result = await applyProjection(projection, {
      playbookId: PLAYBOOK_ID,
      sourceContentId: SOURCE_ID_A,
    });

    expect(mockTx.parameter.create).not.toHaveBeenCalled();
    expect(mockTx.behaviorTarget.create).not.toHaveBeenCalled();
    expect(mockTx.behaviorTarget.update).not.toHaveBeenCalled();
    expect(mockTx.behaviorTarget.delete).not.toHaveBeenCalled();
    expect(mockTx.curriculumModule.create).not.toHaveBeenCalled();
    expect(mockTx.curriculumModule.delete).not.toHaveBeenCalled();
    expect(result.parametersUpserted).toBe(0);
    expect(result.behaviorTargetsCreated).toBe(0);
    expect(result.curriculumModulesCreated).toBe(0);
    expect(result.noop).toBe(true);
  });

  it("throws when the playbook does not exist", async () => {
    mockTx.playbook.findUnique.mockResolvedValue(null);
    const { applyProjection } = await import("../apply-projection");
    const projection = ieltsProjection();
    await expect(
      applyProjection(projection, { playbookId: PLAYBOOK_ID, sourceContentId: SOURCE_ID_A }),
    ).rejects.toThrow(/playbook .* not found/);
  });
});
