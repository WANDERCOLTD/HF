import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(__dirname, "fixtures");
const IELTS_V22 = readFileSync(join(FIXTURES, "course-reference-ielts-v2.2.md"), "utf-8");

const PLAYBOOK_ID = "pb-test-00000000-0000-0000-0000-000000000000";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockPrismaState: {
  playbookSource: { findMany: ReturnType<typeof vi.fn> };
} = {
  playbookSource: { findMany: vi.fn() },
};

const mockStorageDownload = vi.fn();

const mockExtractTextFromBuffer = vi.fn();

const mockApplyProjection = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({} as Record<string, unknown>, {
    get: (_target, prop: string) => mockPrismaState[prop as keyof typeof mockPrismaState],
  }),
}));

vi.mock("@/lib/storage", () => ({
  getStorageAdapter: () => ({ download: mockStorageDownload }),
}));

vi.mock("@/lib/content-trust/extract-assertions", () => ({
  extractTextFromBuffer: mockExtractTextFromBuffer,
}));

const mockWriteBandThresholds = vi.fn().mockResolvedValue({ parametersUpdated: 0, unmatchedCodes: [] });

vi.mock("../apply-projection", () => ({
  applyProjection: mockApplyProjection,
  writeBandThresholds: mockWriteBandThresholds,
}));

// ── Suite ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockPrismaState.playbookSource.findMany.mockReset();
  mockStorageDownload.mockReset();
  mockExtractTextFromBuffer.mockReset();
  mockApplyProjection.mockReset();
  mockWriteBandThresholds.mockReset();
  mockWriteBandThresholds.mockResolvedValue({ parametersUpdated: 0, unmatchedCodes: [] });

  // #564 — every test exercises TWO findMany calls (COURSE_REFERENCE pass +
  // ASSESSOR_RUBRIC pass). Mock the COURSE_REFERENCE side per-test via
  // setSources(); the ASSESSOR_RUBRIC side defaults to empty unless a test
  // calls setRubricSources().
  mockPrismaState.playbookSource.findMany.mockImplementation((args: any) => {
    const docType = args?.where?.source?.documentType;
    if (docType === "COURSE_REFERENCE_ASSESSOR_RUBRIC") {
      return Promise.resolve(testState.rubricSources);
    }
    return Promise.resolve(testState.courseRefSources);
  });
});

const testState: { courseRefSources: unknown[]; rubricSources: unknown[] } = {
  courseRefSources: [],
  rubricSources: [],
};
const setSources = (sources: unknown[]) => {
  testState.courseRefSources = sources;
  testState.rubricSources = [];
};
const setRubricSources = (sources: unknown[]) => {
  testState.rubricSources = sources;
};

describe("runProjectionForPlaybook", () => {
  it("returns degenerate=true when no COURSE_REFERENCE source is linked", async () => {
    setSources([]);

    const { runProjectionForPlaybook } = await import("../run-projection-for-playbook");
    const result = await runProjectionForPlaybook(PLAYBOOK_ID);

    expect(result.degenerate).toBe(true);
    expect(result.appliedSources).toEqual([]);
    expect(result.skippedSources).toEqual([]);
    expect(mockApplyProjection).not.toHaveBeenCalled();
  });

  it("skips a source with no MediaAsset and logs the reason", async () => {
    setSources([
      {
        source: {
          id: "src-1",
          name: "URL-only source",
          mediaAssets: [],
        },
      },
    ]);

    const { runProjectionForPlaybook } = await import("../run-projection-for-playbook");
    const result = await runProjectionForPlaybook(PLAYBOOK_ID);

    expect(result.degenerate).toBe(false);
    expect(result.appliedSources).toEqual([]);
    expect(result.skippedSources).toEqual([
      { sourceContentId: "src-1", sourceName: "URL-only source", reason: "no-media-asset" },
    ]);
    expect(mockApplyProjection).not.toHaveBeenCalled();
  });

  it("skips a source whose storage download throws (extraction race)", async () => {
    setSources([
      {
        source: {
          id: "src-2",
          name: "Mid-upload source",
          mediaAssets: [{ storageKey: "key-2", fileName: "course-ref.md" }],
        },
      },
    ]);
    mockStorageDownload.mockRejectedValue(new Error("ENOENT: not found"));

    const { runProjectionForPlaybook } = await import("../run-projection-for-playbook");
    const result = await runProjectionForPlaybook(PLAYBOOK_ID);

    expect(result.appliedSources).toEqual([]);
    expect(result.skippedSources[0].sourceContentId).toBe("src-2");
    expect(result.skippedSources[0].reason).toContain("load-failed");
    expect(mockApplyProjection).not.toHaveBeenCalled();
  });

  it("skips a source whose extracted text is empty", async () => {
    setSources([
      {
        source: {
          id: "src-3",
          name: "Empty source",
          mediaAssets: [{ storageKey: "key-3", fileName: "empty.md" }],
        },
      },
    ]);
    mockStorageDownload.mockResolvedValue(Buffer.from(""));
    mockExtractTextFromBuffer.mockResolvedValue({ text: "", fileType: "text" });

    const { runProjectionForPlaybook } = await import("../run-projection-for-playbook");
    const result = await runProjectionForPlaybook(PLAYBOOK_ID);

    expect(result.appliedSources).toEqual([]);
    expect(result.skippedSources[0].reason).toBe("empty-text");
    expect(mockApplyProjection).not.toHaveBeenCalled();
  });

  it("loads, projects, and applies an IELTS COURSE_REFERENCE — expect 4 BTs + 5 modules", async () => {
    setSources([
      {
        source: {
          id: "src-ielts",
          name: "IELTS Speaking course-ref",
          mediaAssets: [{ storageKey: "key-ielts", fileName: "course-reference-ielts-v2.2.md" }],
        },
      },
    ]);
    mockStorageDownload.mockResolvedValue(Buffer.from(IELTS_V22));
    mockExtractTextFromBuffer.mockResolvedValue({ text: IELTS_V22, fileType: "text" });
    mockApplyProjection.mockResolvedValue({
      parametersUpserted: 4,
      behaviorTargetsCreated: 4,
      behaviorTargetsUpdated: 0,
      behaviorTargetsRemoved: 0,
      curriculumModulesCreated: 5,
      curriculumModulesUpdated: 0,
      curriculumModulesRemoved: 0,
      learningObjectivesCreated: 27,
      learningObjectivesUpdated: 0,
      learningObjectivesRemoved: 0,
      goalTemplatesWritten: 25,
      curriculumId: "cur-1",
      warnings: [],
      noop: false,
    });

    const { runProjectionForPlaybook } = await import("../run-projection-for-playbook");
    const result = await runProjectionForPlaybook(PLAYBOOK_ID);

    expect(result.degenerate).toBe(false);
    expect(result.appliedSources).toHaveLength(1);
    expect(result.appliedSources[0].sourceContentId).toBe("src-ielts");
    expect(result.skippedSources).toEqual([]);

    expect(mockApplyProjection).toHaveBeenCalledTimes(1);
    const [projection, opts] = mockApplyProjection.mock.calls[0];
    expect(opts).toEqual({ playbookId: PLAYBOOK_ID, sourceContentId: "src-ielts" });
    // The orchestrator's projection should be derived from IELTS — assert
    // it carries the canonical 4 skill parameters.
    expect(projection.parameters.map((p: { name: string }) => p.name)).toContain(
      "skill_fluency_and_coherence",
    );
  });

  it("logs LO counts alongside params/bt/cm/goals in the applied line (#365)", async () => {
    setSources([
      {
        source: {
          id: "src-ielts",
          name: "IELTS Speaking course-ref",
          mediaAssets: [{ storageKey: "key-ielts", fileName: "course-reference-ielts-v2.2.md" }],
        },
      },
    ]);
    mockStorageDownload.mockResolvedValue(Buffer.from(IELTS_V22));
    mockExtractTextFromBuffer.mockResolvedValue({ text: IELTS_V22, fileType: "text" });
    mockApplyProjection.mockResolvedValue({
      parametersUpserted: 4,
      behaviorTargetsCreated: 4,
      behaviorTargetsUpdated: 0,
      behaviorTargetsRemoved: 0,
      curriculumModulesCreated: 5,
      curriculumModulesUpdated: 0,
      curriculumModulesRemoved: 0,
      learningObjectivesCreated: 27,
      learningObjectivesUpdated: 1,
      learningObjectivesRemoved: 2,
      goalTemplatesWritten: 25,
      curriculumId: "cur-1",
      warnings: [],
      noop: false,
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { runProjectionForPlaybook } = await import("../run-projection-for-playbook");
      await runProjectionForPlaybook(PLAYBOOK_ID);
      const lines = logSpy.mock.calls.map((c) => String(c[0]));
      const applied = lines.find((l) => l.includes("[projection] applied"));
      expect(applied).toBeDefined();
      expect(applied).toContain("lo=+27/~1/-2");
      // Existing counters still present and ordered before lo=
      expect(applied).toMatch(/cm=\+5\/~0\/-0 lo=\+27\/~1\/-2 goals=25/);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("excludes COURSE_REFERENCE_ASSESSOR_RUBRIC from the documentType filter (#447)", async () => {
    setSources([]);

    const { runProjectionForPlaybook } = await import("../run-projection-for-playbook");
    await runProjectionForPlaybook(PLAYBOOK_ID);

    expect(mockPrismaState.playbookSource.findMany).toHaveBeenCalledTimes(1);
    const args = mockPrismaState.playbookSource.findMany.mock.calls[0][0];
    const inList = args.where.source.documentType.in as string[];
    expect(inList).toContain("COURSE_REFERENCE");
    expect(inList).toContain("COURSE_REFERENCE_CANONICAL");
    expect(inList).toContain("COURSE_REFERENCE_TUTOR_BRIEFING");
    expect(inList).not.toContain("COURSE_REFERENCE_ASSESSOR_RUBRIC");
  });

  it("applies multiple COURSE_REFERENCE sources in order, accumulating results", async () => {
    setSources([
      {
        source: {
          id: "src-a",
          name: "A",
          mediaAssets: [{ storageKey: "ka", fileName: "a.md" }],
        },
      },
      {
        source: {
          id: "src-b",
          name: "B",
          mediaAssets: [{ storageKey: "kb", fileName: "b.md" }],
        },
      },
    ]);
    mockStorageDownload.mockResolvedValue(Buffer.from(IELTS_V22));
    mockExtractTextFromBuffer.mockResolvedValue({ text: IELTS_V22, fileType: "text" });
    mockApplyProjection.mockResolvedValue({
      parametersUpserted: 0,
      behaviorTargetsCreated: 0,
      behaviorTargetsUpdated: 0,
      behaviorTargetsRemoved: 0,
      curriculumModulesCreated: 0,
      curriculumModulesUpdated: 0,
      curriculumModulesRemoved: 0,
      learningObjectivesCreated: 0,
      learningObjectivesUpdated: 0,
      learningObjectivesRemoved: 0,
      goalTemplatesWritten: 25,
      curriculumId: "cur-1",
      warnings: [],
      noop: true,
    });

    const { runProjectionForPlaybook } = await import("../run-projection-for-playbook");
    const result = await runProjectionForPlaybook(PLAYBOOK_ID);

    expect(result.appliedSources.map((s) => s.sourceContentId)).toEqual(["src-a", "src-b"]);
    expect(mockApplyProjection).toHaveBeenCalledTimes(2);
  });

  // ── #564 — rubric-only second pass ────────────────────────────────────────

  it("runs the rubric pass alongside the main pass when an ASSESSOR_RUBRIC source is linked", async () => {
    setSources([
      {
        source: {
          id: "src-courseref",
          name: "IELTS Course-ref",
          mediaAssets: [{ storageKey: "ck", fileName: "course-ref.md" }],
        },
      },
    ]);
    setRubricSources([
      {
        source: {
          id: "src-rubric",
          name: "IELTS Rubric",
          mediaAssets: [{ storageKey: "rk", fileName: "assessor-rubric.md" }],
        },
      },
    ]);
    // Course-ref text triggers normal projection; rubric text has RUB-FC heading + table
    mockStorageDownload.mockImplementation((key: string) =>
      key === "rk"
        ? Promise.resolve(
            Buffer.from(`## RUB-FC: Fluency

| Band | Descriptor |
| 9 | Top FC band |
| 5 | Mid FC band |
`),
          )
        : Promise.resolve(Buffer.from(IELTS_V22)),
    );
    mockExtractTextFromBuffer.mockImplementation((buffer: Buffer) => ({
      text: buffer.toString("utf-8"),
      fileType: "text",
    }));
    mockApplyProjection.mockResolvedValue({
      parametersUpserted: 4,
      behaviorTargetsCreated: 4,
      behaviorTargetsUpdated: 0,
      behaviorTargetsRemoved: 0,
      curriculumModulesCreated: 5,
      curriculumModulesUpdated: 0,
      curriculumModulesRemoved: 0,
      learningObjectivesCreated: 27,
      learningObjectivesUpdated: 0,
      learningObjectivesRemoved: 0,
      goalTemplatesWritten: 25,
      curriculumId: "curr-1",
      measureSpecId: "spec-1",
      measureTriggerCount: 1,
      warnings: [],
      noop: false,
    });
    mockWriteBandThresholds.mockResolvedValue({
      parametersUpdated: 1,
      unmatchedCodes: [],
    });

    const { runProjectionForPlaybook } = await import("../run-projection-for-playbook");
    const result = await runProjectionForPlaybook(PLAYBOOK_ID);

    // Main pass succeeded
    expect(result.appliedSources.map((s) => s.sourceContentId)).toEqual(["src-courseref"]);
    // Rubric pass invoked writeBandThresholds with the parsed FC band map
    expect(mockWriteBandThresholds).toHaveBeenCalledTimes(1);
    const writeCall = mockWriteBandThresholds.mock.calls[0];
    // #UI-followup Gap 2 — writeBandThresholds now receives a criterionByCode
    // map so it can fall back to name-derived matching for fresh courses.
    expect(writeCall[0]).toMatchObject({
      playbookId: PLAYBOOK_ID,
      sourceContentId: "src-rubric",
    });
    expect(writeCall[0].criterionByCode).toBeDefined();
    expect(writeCall[0].criterionByCode.fc).toBeDefined();
    const bandMap = writeCall[1] as Map<string, Record<string, string>>;
    expect(bandMap.has("fc")).toBe(true);
    expect(bandMap.get("fc")?.["9"]).toContain("Top FC");
    // Result reports the rubric pass outcome
    expect(result.rubricBandsApplied).toEqual([
      {
        sourceContentId: "src-rubric",
        sourceName: "IELTS Rubric",
        parametersUpdated: 1,
        unmatchedCodes: [],
      },
    ]);
  });

  it("logs zero rubric activity when no RUB-* sections are found in a rubric source", async () => {
    setSources([
      {
        source: {
          id: "src-courseref",
          name: "IELTS Course-ref",
          mediaAssets: [{ storageKey: "ck", fileName: "course-ref.md" }],
        },
      },
    ]);
    setRubricSources([
      {
        source: {
          id: "src-rubric",
          name: "Boring rubric",
          mediaAssets: [{ storageKey: "rk", fileName: "boring.md" }],
        },
      },
    ]);
    mockStorageDownload.mockImplementation((key: string) =>
      key === "rk"
        ? Promise.resolve(Buffer.from("# No RUB headings here\n\nJust prose."))
        : Promise.resolve(Buffer.from(IELTS_V22)),
    );
    mockExtractTextFromBuffer.mockImplementation((buffer: Buffer) => ({
      text: buffer.toString("utf-8"),
      fileType: "text",
    }));
    mockApplyProjection.mockResolvedValue({
      parametersUpserted: 0,
      behaviorTargetsCreated: 0,
      behaviorTargetsUpdated: 0,
      behaviorTargetsRemoved: 0,
      curriculumModulesCreated: 0,
      curriculumModulesUpdated: 0,
      curriculumModulesRemoved: 0,
      learningObjectivesCreated: 0,
      learningObjectivesUpdated: 0,
      learningObjectivesRemoved: 0,
      goalTemplatesWritten: 0,
      curriculumId: "curr-1",
      measureSpecId: null,
      measureTriggerCount: 0,
      warnings: [],
      noop: true,
    });

    const { runProjectionForPlaybook } = await import("../run-projection-for-playbook");
    const result = await runProjectionForPlaybook(PLAYBOOK_ID);

    expect(mockWriteBandThresholds).not.toHaveBeenCalled();
    expect(result.rubricBandsApplied).toEqual([]);
  });

  // (3) Publish-time launch blocker — PROJECTION_NO_SKILLS_FRAMEWORK upgraded
  // from a soft validation warning to a launch blocker. The publish gate
  // consumes `launchBlockers` and refuses to mark Playbook PUBLISHED when
  // any entry is present.
  describe("launch blockers", () => {
    it("emits NO_COURSE_REFERENCE_SOURCE blocker when no course-ref source is linked", async () => {
      setSources([]);
      const { runProjectionForPlaybook } = await import("../run-projection-for-playbook");
      const result = await runProjectionForPlaybook(PLAYBOOK_ID);

      expect(result.degenerate).toBe(true);
      expect(result.launchBlockers).toEqual([
        expect.objectContaining({ code: "NO_COURSE_REFERENCE_SOURCE" }),
      ]);
    });

    it("emits PROJECTION_NO_SKILLS_FRAMEWORK when the course-ref has no parseable Skills Framework", async () => {
      const noSkills = "# Course\n\n## Outcomes\n\n**OUT-01:** Something.\n";
      setSources([
        {
          source: {
            id: "src-bad",
            name: "course-ref without skills",
            mediaAssets: [{ storageKey: "k", fileName: "course-ref.md" }],
          },
        },
      ]);
      mockStorageDownload.mockResolvedValue(Buffer.from(noSkills));
      mockExtractTextFromBuffer.mockResolvedValue({ text: noSkills, fileType: "text" });
      mockApplyProjection.mockResolvedValue({
        parametersUpserted: 0,
        behaviorTargetsCreated: 0,
        behaviorTargetsUpdated: 0,
        behaviorTargetsRemoved: 0,
        curriculumModulesCreated: 0,
        curriculumModulesUpdated: 0,
        curriculumModulesRemoved: 0,
        learningObjectivesCreated: 0,
        learningObjectivesUpdated: 0,
        learningObjectivesRemoved: 0,
        goalTemplatesWritten: 0,
        curriculumId: "curr-1",
        measureSpecId: null,
        measureTriggerCount: 0,
        warnings: [],
        noop: true,
      });

      const { runProjectionForPlaybook } = await import("../run-projection-for-playbook");
      const result = await runProjectionForPlaybook(PLAYBOOK_ID);

      expect(result.launchBlockers).toEqual([
        expect.objectContaining({
          code: "PROJECTION_NO_SKILLS_FRAMEWORK",
          sourceContentId: "src-bad",
          sourceName: "course-ref without skills",
        }),
      ]);
    });

    it("clears PROJECTION_NO_SKILLS_FRAMEWORK when at least one applied source produced Parameters", async () => {
      // Two sources: first has no skills, second is IELTS with the full 4-skill
      // framework. The educator only needs ONE source with a Skills Framework.
      setSources([
        {
          source: {
            id: "src-bad",
            name: "no-skills",
            mediaAssets: [{ storageKey: "k1", fileName: "course-ref.md" }],
          },
        },
        {
          source: {
            id: "src-ielts",
            name: "IELTS course-ref",
            mediaAssets: [{ storageKey: "k2", fileName: "ielts.md" }],
          },
        },
      ]);
      mockStorageDownload.mockImplementation((key: string) =>
        key === "k2"
          ? Promise.resolve(Buffer.from(IELTS_V22))
          : Promise.resolve(Buffer.from("# Course\n\n## Outcomes\n\n**OUT-01:** Hi.\n")),
      );
      mockExtractTextFromBuffer.mockImplementation((buffer: Buffer) => ({
        text: buffer.toString("utf-8"),
        fileType: "text",
      }));
      // Per-call mock: first call returns 0 params, second returns 4.
      mockApplyProjection
        .mockResolvedValueOnce({
          parametersUpserted: 0,
          behaviorTargetsCreated: 0,
          behaviorTargetsUpdated: 0,
          behaviorTargetsRemoved: 0,
          curriculumModulesCreated: 0,
          curriculumModulesUpdated: 0,
          curriculumModulesRemoved: 0,
          learningObjectivesCreated: 0,
          learningObjectivesUpdated: 0,
          learningObjectivesRemoved: 0,
          goalTemplatesWritten: 0,
          curriculumId: "curr-1",
          measureSpecId: null,
          measureTriggerCount: 0,
          warnings: [],
          noop: true,
        })
        .mockResolvedValueOnce({
          parametersUpserted: 4,
          behaviorTargetsCreated: 4,
          behaviorTargetsUpdated: 0,
          behaviorTargetsRemoved: 0,
          curriculumModulesCreated: 5,
          curriculumModulesUpdated: 0,
          curriculumModulesRemoved: 0,
          learningObjectivesCreated: 27,
          learningObjectivesUpdated: 0,
          learningObjectivesRemoved: 0,
          goalTemplatesWritten: 25,
          curriculumId: "curr-1",
          measureSpecId: "msp-1",
          measureTriggerCount: 4,
          warnings: [],
          noop: false,
        });

      const { runProjectionForPlaybook } = await import("../run-projection-for-playbook");
      const result = await runProjectionForPlaybook(PLAYBOOK_ID);

      expect(result.launchBlockers).toEqual([]);
    });

    it("returns launchBlockers: [] when the course-ref has a parseable Skills Framework", async () => {
      setSources([
        {
          source: {
            id: "src-ielts",
            name: "IELTS",
            mediaAssets: [{ storageKey: "k", fileName: "ielts.md" }],
          },
        },
      ]);
      mockStorageDownload.mockResolvedValue(Buffer.from(IELTS_V22));
      mockExtractTextFromBuffer.mockResolvedValue({ text: IELTS_V22, fileType: "text" });
      mockApplyProjection.mockResolvedValue({
        parametersUpserted: 4,
        behaviorTargetsCreated: 4,
        behaviorTargetsUpdated: 0,
        behaviorTargetsRemoved: 0,
        curriculumModulesCreated: 5,
        curriculumModulesUpdated: 0,
        curriculumModulesRemoved: 0,
        learningObjectivesCreated: 27,
        learningObjectivesUpdated: 0,
        learningObjectivesRemoved: 0,
        goalTemplatesWritten: 25,
        curriculumId: "curr-1",
        measureSpecId: "msp-1",
        measureTriggerCount: 4,
        warnings: [],
        noop: false,
      });

      const { runProjectionForPlaybook } = await import("../run-projection-for-playbook");
      const result = await runProjectionForPlaybook(PLAYBOOK_ID);

      expect(result.launchBlockers).toEqual([]);
    });
  });
});
