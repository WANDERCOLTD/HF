/**
 * #492 Slice 3.6 — mockDiagnostic loader + transform + composition wiring tests.
 *
 * Covers:
 *   - No DIAGNOSTIC row → hasDiagnostic: false
 *   - Valid row → fields resolved + module titles loaded
 *   - JSON parse failure → hasDiagnostic: false, warn logged
 *   - fromCallId === currentCallId → hasDiagnostic: false (chicken/egg skip)
 *   - Diagnostic references deleted module → that entry dropped
 *   - Multiple rows over time → most recent (by updatedAt) wins
 *   - transform: emits a block on hasDiagnostic=true, null when empty
 *   - Composition: section appears in llmPrompt when present, omitted otherwise
 *   - getDefaultSections registers mock_diagnostic between prior_call_feedback
 *     and session_planning
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadMockDiagnostic } from "@/lib/prompt/composition/loaders/mockDiagnostic";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";

// Trigger transform registration
import "@/lib/prompt/composition/transforms/mockDiagnostic";

// =====================================================
// Helpers
// =====================================================

interface FakeAttributeRow {
  callerId: string;
  scope: string;
  key: string;
  stringValue: string | null;
  updatedAt: Date;
}

interface FakeModuleRow {
  id: string;
  slug: string;
  title: string;
}

function makePrismaStub(opts: {
  attributes?: FakeAttributeRow[];
  modules?: FakeModuleRow[];
}) {
  const attributes = opts.attributes ?? [];
  const modules = opts.modules ?? [];

  const callerAttribute = {
    findFirst: vi.fn(async ({ where, orderBy }: any) => {
      let matches = attributes.filter((row) => {
        if (where.callerId && row.callerId !== where.callerId) return false;
        if (where.scope && row.scope !== where.scope) return false;
        if (where.key && row.key !== where.key) return false;
        return true;
      });
      if (orderBy?.updatedAt === "desc") {
        matches = [...matches].sort(
          (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
        );
      }
      return matches[0] ?? null;
    }),
  };
  const curriculumModule = {
    findMany: vi.fn(async ({ where }: any) => {
      const ids: string[] = where?.id?.in ?? [];
      return modules.filter((m) => ids.includes(m.id));
    }),
  };
  return { callerAttribute, curriculumModule } as any;
}

const NOW = new Date("2026-05-19T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const SAMPLE_DIAGNOSTIC = {
  focusModules: ["mod-part1", "mod-part2"],
  strengthModule: "mod-part3",
  weakSkill: "fluency",
  summary:
    "On your Mock, your strongest area was Part 3. To improve, focus next on Part 1, Part 2.",
  fromCallId: "call-mock-1",
  generatedAt: daysAgo(3).toISOString(),
};

const SAMPLE_MODULES: FakeModuleRow[] = [
  { id: "mod-part1", slug: "ielts-part-1", title: "Part 1: Introduction" },
  { id: "mod-part2", slug: "ielts-part-2", title: "Part 2: Long turn" },
  { id: "mod-part3", slug: "ielts-part-3", title: "Part 3: Discussion" },
];

// =====================================================
// Loader tests
// =====================================================

describe("loadMockDiagnostic", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns hasDiagnostic: false when no DIAGNOSTIC row exists", async () => {
    const prisma = makePrismaStub({ attributes: [] });
    const result = await loadMockDiagnostic(prisma, {
      callerId: "caller-1",
      currentCallId: "call-current",
      now: NOW,
    });
    expect(result.hasDiagnostic).toBe(false);
    expect(result.focusModules).toEqual([]);
    expect(result.strengthModule).toBeNull();
    expect(result.summary).toBeNull();
    expect(result.fromCallId).toBeNull();
    expect(result.generatedAt).toBeNull();
    expect(result.ageInDays).toBeNull();
  });

  it("returns hasDiagnostic: false when callerId is empty (short-circuits before prisma)", async () => {
    const prisma = makePrismaStub({});
    const result = await loadMockDiagnostic(prisma, {
      callerId: "",
      currentCallId: "call-current",
      now: NOW,
    });
    expect(result.hasDiagnostic).toBe(false);
    expect(prisma.callerAttribute.findFirst).not.toHaveBeenCalled();
  });

  it("resolves all fields + module titles from a valid row", async () => {
    const prisma = makePrismaStub({
      attributes: [
        {
          callerId: "caller-1",
          scope: "DIAGNOSTIC",
          key: "fromMock",
          stringValue: JSON.stringify(SAMPLE_DIAGNOSTIC),
          updatedAt: daysAgo(3),
        },
      ],
      modules: SAMPLE_MODULES,
    });

    const result = await loadMockDiagnostic(prisma, {
      callerId: "caller-1",
      currentCallId: "call-next",
      now: NOW,
    });

    expect(result.hasDiagnostic).toBe(true);
    expect(result.focusModules).toEqual([
      { id: "mod-part1", slug: "ielts-part-1", title: "Part 1: Introduction" },
      { id: "mod-part2", slug: "ielts-part-2", title: "Part 2: Long turn" },
    ]);
    expect(result.strengthModule).toEqual({
      id: "mod-part3",
      slug: "ielts-part-3",
      title: "Part 3: Discussion",
    });
    expect(result.weakSkill).toBe("fluency");
    expect(result.summary).toBe(SAMPLE_DIAGNOSTIC.summary);
    expect(result.fromCallId).toBe("call-mock-1");
    expect(result.generatedAt).toBe(SAMPLE_DIAGNOSTIC.generatedAt);
    expect(result.ageInDays).toBe(3);
  });

  it("returns hasDiagnostic: false and logs warn on JSON parse failure", async () => {
    const prisma = makePrismaStub({
      attributes: [
        {
          callerId: "caller-1",
          scope: "DIAGNOSTIC",
          key: "fromMock",
          stringValue: "{ not: 'valid json'",
          updatedAt: NOW,
        },
      ],
    });

    const result = await loadMockDiagnostic(prisma, {
      callerId: "caller-1",
      currentCallId: "call-current",
      now: NOW,
    });

    expect(result.hasDiagnostic).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[mockDiagnostic] Failed to parse"),
      expect.any(String),
    );
  });

  it("returns hasDiagnostic: false when stringValue is null", async () => {
    const prisma = makePrismaStub({
      attributes: [
        {
          callerId: "caller-1",
          scope: "DIAGNOSTIC",
          key: "fromMock",
          stringValue: null,
          updatedAt: NOW,
        },
      ],
    });

    const result = await loadMockDiagnostic(prisma, {
      callerId: "caller-1",
      currentCallId: "call-current",
      now: NOW,
    });

    expect(result.hasDiagnostic).toBe(false);
  });

  it("chicken/egg skip — fromCallId === currentCallId returns hasDiagnostic: false", async () => {
    const prisma = makePrismaStub({
      attributes: [
        {
          callerId: "caller-1",
          scope: "DIAGNOSTIC",
          key: "fromMock",
          stringValue: JSON.stringify({
            ...SAMPLE_DIAGNOSTIC,
            fromCallId: "call-current",
          }),
          updatedAt: daysAgo(0),
        },
      ],
      modules: SAMPLE_MODULES,
    });

    const result = await loadMockDiagnostic(prisma, {
      callerId: "caller-1",
      currentCallId: "call-current",
      now: NOW,
    });

    expect(result.hasDiagnostic).toBe(false);
    // We never reached the module-resolution step.
    expect(prisma.curriculumModule.findMany).not.toHaveBeenCalled();
  });

  it("drops focusModule entries whose CurriculumModule no longer exists", async () => {
    const prisma = makePrismaStub({
      attributes: [
        {
          callerId: "caller-1",
          scope: "DIAGNOSTIC",
          key: "fromMock",
          stringValue: JSON.stringify({
            ...SAMPLE_DIAGNOSTIC,
            focusModules: ["mod-part1", "mod-DELETED", "mod-part2"],
          }),
          updatedAt: daysAgo(2),
        },
      ],
      // mod-DELETED is intentionally missing from the modules table.
      modules: SAMPLE_MODULES,
    });

    const result = await loadMockDiagnostic(prisma, {
      callerId: "caller-1",
      currentCallId: "call-next",
      now: NOW,
    });

    expect(result.hasDiagnostic).toBe(true);
    expect(result.focusModules.map((m) => m.id)).toEqual([
      "mod-part1",
      "mod-part2",
    ]);
  });

  it("zeroes strengthModule when the referenced CurriculumModule is missing", async () => {
    const prisma = makePrismaStub({
      attributes: [
        {
          callerId: "caller-1",
          scope: "DIAGNOSTIC",
          key: "fromMock",
          stringValue: JSON.stringify({
            ...SAMPLE_DIAGNOSTIC,
            strengthModule: "mod-DELETED",
          }),
          updatedAt: daysAgo(2),
        },
      ],
      modules: SAMPLE_MODULES, // mod-DELETED absent
    });

    const result = await loadMockDiagnostic(prisma, {
      callerId: "caller-1",
      currentCallId: "call-next",
      now: NOW,
    });

    expect(result.hasDiagnostic).toBe(true);
    expect(result.strengthModule).toBeNull();
  });

  it("uses the most recent row when multiple DIAGNOSTIC/fromMock rows exist", async () => {
    const prisma = makePrismaStub({
      attributes: [
        {
          callerId: "caller-1",
          scope: "DIAGNOSTIC",
          key: "fromMock",
          stringValue: JSON.stringify({
            ...SAMPLE_DIAGNOSTIC,
            summary: "OLD summary",
            fromCallId: "call-old",
          }),
          updatedAt: daysAgo(30),
        },
        {
          callerId: "caller-1",
          scope: "DIAGNOSTIC",
          key: "fromMock",
          stringValue: JSON.stringify({
            ...SAMPLE_DIAGNOSTIC,
            summary: "NEW summary",
            fromCallId: "call-new",
          }),
          updatedAt: daysAgo(1),
        },
      ],
      modules: SAMPLE_MODULES,
    });

    const result = await loadMockDiagnostic(prisma, {
      callerId: "caller-1",
      currentCallId: "call-next",
      now: NOW,
    });

    expect(result.summary).toBe("NEW summary");
    expect(result.fromCallId).toBe("call-new");
  });

  it("does not pick up rows for other callers or other scopes/keys", async () => {
    const prisma = makePrismaStub({
      attributes: [
        {
          callerId: "OTHER-caller",
          scope: "DIAGNOSTIC",
          key: "fromMock",
          stringValue: JSON.stringify(SAMPLE_DIAGNOSTIC),
          updatedAt: daysAgo(1),
        },
        {
          callerId: "caller-1",
          scope: "GLOBAL", // wrong scope
          key: "fromMock",
          stringValue: JSON.stringify(SAMPLE_DIAGNOSTIC),
          updatedAt: daysAgo(1),
        },
        {
          callerId: "caller-1",
          scope: "DIAGNOSTIC",
          key: "somethingElse", // wrong key
          stringValue: JSON.stringify(SAMPLE_DIAGNOSTIC),
          updatedAt: daysAgo(1),
        },
      ],
      modules: SAMPLE_MODULES,
    });

    const result = await loadMockDiagnostic(prisma, {
      callerId: "caller-1",
      currentCallId: "call-next",
      now: NOW,
    });

    expect(result.hasDiagnostic).toBe(false);
  });

  it("ageInDays is null when generatedAt is missing or unparseable", async () => {
    const prisma = makePrismaStub({
      attributes: [
        {
          callerId: "caller-1",
          scope: "DIAGNOSTIC",
          key: "fromMock",
          stringValue: JSON.stringify({
            ...SAMPLE_DIAGNOSTIC,
            generatedAt: "not-a-date",
          }),
          updatedAt: daysAgo(1),
        },
      ],
      modules: SAMPLE_MODULES,
    });

    const result = await loadMockDiagnostic(prisma, {
      callerId: "caller-1",
      currentCallId: "call-next",
      now: NOW,
    });

    expect(result.hasDiagnostic).toBe(true);
    expect(result.ageInDays).toBeNull();
  });
});

// =====================================================
// Transform tests
// =====================================================

describe("renderMockDiagnostic transform", () => {
  it("emits a markdown block when hasDiagnostic=true", () => {
    const transform = getTransform("renderMockDiagnostic");
    expect(transform).toBeDefined();

    const result = transform!(
      {
        hasDiagnostic: true,
        focusModules: [
          { id: "mod-part1", slug: "p1", title: "Part 1" },
          { id: "mod-part2", slug: "p2", title: "Part 2" },
        ],
        strengthModule: { id: "mod-part3", slug: "p3", title: "Part 3" },
        weakSkill: "fluency",
        summary: "On your Mock, your strongest area was Part 3.",
        fromCallId: "call-mock-1",
        generatedAt: "2026-05-16T10:00:00Z",
        ageInDays: 3,
      },
      {} as any,
      {} as any,
    );

    expect(result).not.toBeNull();
    expect(result.hasDiagnostic).toBe(true);
    expect(result.heading).toBe("Recent mock diagnostic (3 days ago)");
    expect(result.body).toContain("## Recent mock diagnostic (3 days ago)");
    expect(result.body).toContain("Your strongest area: Part 3");
    expect(result.body).toContain("To improve, focus on: Part 1, Part 2");
    expect(result.body).toContain("Weakest skill: fluency");
    expect(result.body).toContain("On your Mock, your strongest area was Part 3.");
    expect(result.strengthTitle).toBe("Part 3");
    expect(result.focusTitles).toEqual(["Part 1", "Part 2"]);
  });

  it("formats age as 'yesterday' / 'today' near zero", () => {
    const transform = getTransform("renderMockDiagnostic");
    const base = {
      hasDiagnostic: true,
      focusModules: [{ id: "m1", slug: "m1", title: "M1" }],
      strengthModule: null,
      weakSkill: null,
      summary: "X",
      fromCallId: "c",
      generatedAt: "2026-05-16T10:00:00Z",
    };

    const t = transform!({ ...base, ageInDays: 0 }, {} as any, {} as any);
    expect(t.heading).toBe("Recent mock diagnostic (today)");

    const y = transform!({ ...base, ageInDays: 1 }, {} as any, {} as any);
    expect(y.heading).toBe("Recent mock diagnostic (yesterday)");

    const n = transform!({ ...base, ageInDays: null }, {} as any, {} as any);
    expect(n.heading).toBe("Recent mock diagnostic (recently)");
  });

  it("omits lines for absent fields rather than printing 'undefined'", () => {
    const transform = getTransform("renderMockDiagnostic");
    const result = transform!(
      {
        hasDiagnostic: true,
        focusModules: [{ id: "m1", slug: "m1", title: "Part 1" }],
        strengthModule: null,
        weakSkill: null,
        summary: null,
        fromCallId: "c",
        generatedAt: null,
        ageInDays: null,
      },
      {} as any,
      {} as any,
    );

    expect(result).not.toBeNull();
    expect(result.body).toContain("To improve, focus on: Part 1");
    expect(result.body).not.toMatch(/undefined/i);
    expect(result.body).not.toContain("Your strongest area:");
    expect(result.body).not.toContain("Weakest skill:");
  });

  it("returns null when hasDiagnostic=false", () => {
    const transform = getTransform("renderMockDiagnostic");
    const result = transform!(
      {
        hasDiagnostic: false,
        focusModules: [],
        strengthModule: null,
        weakSkill: null,
        summary: null,
        fromCallId: null,
        generatedAt: null,
        ageInDays: null,
      },
      {} as any,
      {} as any,
    );
    expect(result).toBeNull();
  });

  it("returns null when raw data is missing entirely", () => {
    const transform = getTransform("renderMockDiagnostic");
    expect(transform!(null, {} as any, {} as any)).toBeNull();
    expect(transform!(undefined, {} as any, {} as any)).toBeNull();
  });

  it("returns null when hasDiagnostic=true but every field is empty (defensive)", () => {
    const transform = getTransform("renderMockDiagnostic");
    const result = transform!(
      {
        hasDiagnostic: true,
        focusModules: [],
        strengthModule: null,
        weakSkill: null,
        summary: null,
        fromCallId: "c",
        generatedAt: null,
        ageInDays: null,
      },
      {} as any,
      {} as any,
    );
    expect(result).toBeNull();
  });
});

// =====================================================
// Default-sections registration
// =====================================================

describe("mockDiagnostic in getDefaultSections", () => {
  it("registers the mock_diagnostic section between prior_call_feedback and session_planning", async () => {
    const { getDefaultSections } = await import(
      "@/lib/prompt/composition/CompositionExecutor"
    );
    const sections = getDefaultSections();
    const ids = sections.map((s) => s.id);

    const idxPrior = ids.indexOf("prior_call_feedback");
    const idxMock = ids.indexOf("mock_diagnostic");
    const idxSession = ids.indexOf("session_planning");

    expect(idxPrior).toBeGreaterThanOrEqual(0);
    expect(idxMock).toBeGreaterThanOrEqual(0);
    expect(idxSession).toBeGreaterThanOrEqual(0);

    expect(idxMock).toBeGreaterThan(idxPrior);
    expect(idxMock).toBeLessThan(idxSession);

    const section = sections[idxMock];
    expect(section.outputKey).toBe("mockDiagnostic");
    expect(section.dataSource).toBe("mockDiagnostic");
    expect(section.transform).toBe("renderMockDiagnostic");
    expect(section.dependsOn).toContain("curriculum");
    expect(section.activateWhen.condition).toBe("mockDiagnosticExists");
    expect(section.fallback.action).toBe("omit");
    expect(section.priority).toBe(7.6);
  });
});

// =====================================================
// Composition integration (executor end-to-end)
// =====================================================

describe("mockDiagnostic composition (executor end-to-end)", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/prompt/composition/SectionDataLoader");
    vi.resetModules();
  });

  it("emits the mockDiagnostic section when hasDiagnostic=true and omits otherwise", async () => {
    vi.resetModules();

    const baseLoaded = {
      caller: {
        id: "caller-1",
        name: "Test",
        email: null,
        phone: null,
        externalId: null,
        domain: null,
      },
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
            nextLearnerFacingNumber: 1,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [],
      systemSpecs: [],
      onboardingSpec: null,
      onboardingSession: null,
      subjectSources: null,
      curriculumAssertions: [],
      curriculumQuestions: [],
      curriculumVocabulary: [],
      courseInstructions: [],
      openActions: [],
      visualAids: [],
      priorCallFeedback: {
        hasFeedback: false,
        lastCallAt: null,
        lastCallId: null,
        weakestParameterName: null,
        weakestParameterScore: null,
        overallScore: null,
        summary: null,
      },
    };

    vi.doMock("@/lib/prompt/composition/SectionDataLoader", async () => {
      const actual: any = await vi.importActual(
        "@/lib/prompt/composition/SectionDataLoader",
      );
      return {
        ...actual,
        loadAllData: vi.fn().mockImplementation(async () => {
          const hasDiag = (globalThis as any).__TEST_MOCK_DIAG__ as boolean;
          return {
            ...baseLoaded,
            mockDiagnostic: hasDiag
              ? {
                  hasDiagnostic: true,
                  focusModules: [
                    { id: "m1", slug: "p1", title: "Part 1" },
                    { id: "m2", slug: "p2", title: "Part 2" },
                  ],
                  strengthModule: { id: "m3", slug: "p3", title: "Part 3" },
                  weakSkill: "fluency",
                  summary:
                    "On your Mock, your strongest area was Part 3. To improve, focus next on Part 1, Part 2.",
                  fromCallId: "call-old-mock",
                  generatedAt: "2026-05-16T10:00:00Z",
                  ageInDays: 3,
                }
              : {
                  hasDiagnostic: false,
                  focusModules: [],
                  strengthModule: null,
                  weakSkill: null,
                  summary: null,
                  fromCallId: null,
                  generatedAt: null,
                  ageInDays: null,
                },
          };
        }),
      };
    });

    const { executeComposition, getDefaultSections } = await import(
      "@/lib/prompt/composition/CompositionExecutor"
    );
    const sections = getDefaultSections();

    // ── Case 1: hasDiagnostic = true → section appears ──
    (globalThis as any).__TEST_MOCK_DIAG__ = true;
    const r1 = await executeComposition(
      "caller-1",
      sections,
      {},
      undefined,
      null,
      "call-next",
    );
    expect(r1.metadata.sectionsActivated).toContain("mock_diagnostic");
    expect(r1.llmPrompt.mockDiagnostic).toBeDefined();
    expect(r1.llmPrompt.mockDiagnostic.body).toContain(
      "## Recent mock diagnostic",
    );
    expect(r1.llmPrompt.mockDiagnostic.body).toContain("Part 3");
    expect(r1.llmPrompt.mockDiagnostic.weakSkill).toBe("fluency");

    // ── Case 2: hasDiagnostic = false → section omitted ──
    (globalThis as any).__TEST_MOCK_DIAG__ = false;
    const r2 = await executeComposition(
      "caller-1",
      sections,
      {},
      undefined,
      null,
      "call-next",
    );
    expect(r2.metadata.sectionsSkipped).toContain("mock_diagnostic");
    expect(r2.llmPrompt.mockDiagnostic).toBeUndefined();

    delete (globalThis as any).__TEST_MOCK_DIAG__;
  });
});
