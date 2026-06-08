/**
 * Tests for Cmd+K read-parity tools (#852 follow-up).
 *
 * Verifies the 8 new tools that round out coverage:
 *   - get_playbook_config
 *   - list_behavior_targets
 *   - list_curriculum_modules
 *   - list_goals_for_caller
 *   - recompose_caller_prompt
 *   - update_learning_objective
 *   - update_curriculum_metadata
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  playbook: { findUnique: vi.fn(), update: vi.fn() },
  behaviorTarget: { findMany: vi.fn() },
  caller: { findUnique: vi.fn(), update: vi.fn() },
  curriculum: { findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  curriculumModule: { findMany: vi.fn() },
  goal: { findMany: vi.fn() },
  learningObjective: { findUnique: vi.fn(), update: vi.fn() },
  // Added 2026-06-04: peer #1034's resolveCurriculumIdForPlaybook + the
  // bump-curriculum-fanout helper read prisma.playbookCurriculum. Without
  // this the read-parity tests for update_curriculum_module +
  // list_curriculum_modules + update_curriculum_metadata +
  // update_learning_objective throw. findMany returns [] so the fanout
  // helper's `.length` access doesn't NPE — tests that need rows back
  // override per-test via `playbookCurriculum.findMany.mockResolvedValueOnce`.
  playbookCurriculum: {
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// Stub out the heavy composition stack so recompose tests don't pull it in.
vi.mock("@/lib/prompt/composition", () => ({
  executeComposition: vi.fn(async () => ({ llmPrompt: { sections: [] } })),
  loadComposeConfig: vi.fn(async () => ({
    fullSpecConfig: {},
    sections: [],
    specSlug: "COMP-001",
  })),
  persistComposedPrompt: vi.fn(async () => ({
    id: "cp-1",
    composedAt: new Date("2026-05-26T10:00:00Z"),
  })),
}));
vi.mock("@/lib/prompt/composition/renderPromptSummary", () => ({
  renderPromptSummary: vi.fn(() => "rendered"),
}));

describe("Cmd+K read-parity tools (#852 follow-up)", () => {
  let executeAdminTool: typeof import("@/lib/chat/admin-tool-handlers").executeAdminTool;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/lib/chat/admin-tool-handlers");
    executeAdminTool = mod.executeAdminTool;
    mockPrisma.playbook.update.mockResolvedValue({ id: "pb-1" });
    mockPrisma.caller.update.mockResolvedValue({ id: "c-1" });
  });

  describe("get_playbook_config", () => {
    it("returns config + compose_stale_hint", async () => {
      const stamped = new Date("2026-05-26T09:00:00Z");
      mockPrisma.playbook.findUnique.mockResolvedValue({
        id: "pb-1",
        name: "IELTS",
        description: null,
        status: "PUBLISHED",
        domainId: "d-1",
        version: "1",
        config: { sessionCount: 5, durationMins: 6 },
        composeInputsUpdatedAt: stamped,
        domain: { id: "d-1", name: "ESL", slug: "esl" },
      });

      const raw = await executeAdminTool("get_playbook_config", { playbook_id: "pb-1" }, "OPERATOR");
      const result = JSON.parse(raw);

      expect(result.ok).toBe(true);
      expect(result.playbook.config.sessionCount).toBe(5);
      expect(result.compose_stale_hint).toContain(stamped.toISOString());
    });

    it("returns 'no writes recorded' hint when timestamp null", async () => {
      mockPrisma.playbook.findUnique.mockResolvedValue({
        id: "pb-1",
        name: "X",
        description: null,
        status: "DRAFT",
        domainId: null,
        version: "1",
        config: {},
        composeInputsUpdatedAt: null,
        domain: null,
      });
      const raw = await executeAdminTool("get_playbook_config", { playbook_id: "pb-1" }, "OPERATOR");
      const result = JSON.parse(raw);
      expect(result.compose_stale_hint).toContain("No compose-affecting writes");
    });
  });

  describe("list_behavior_targets", () => {
    it("PLAYBOOK scope returns active targets", async () => {
      mockPrisma.behaviorTarget.findMany.mockResolvedValue([
        {
          id: "bt-1",
          parameterId: "BEH-WARMTH",
          targetValue: 0.7,
          confidence: 1.0,
          source: "MANUAL",
          updatedAt: new Date(),
          parameter: { name: "Warmth", definition: "..." },
        },
      ]);
      const raw = await executeAdminTool(
        "list_behavior_targets",
        { playbook_id: "pb-1" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.scope).toBe("PLAYBOOK");
      expect(result.count).toBe(1);
      expect(result.targets[0].name).toBe("Warmth");
    });

    it("CALLER scope picks MAX across identities for the same parameter", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        callerIdentities: [{ id: "ci-1" }, { id: "ci-2" }],
      });
      mockPrisma.behaviorTarget.findMany.mockResolvedValue([
        {
          id: "bt-1",
          parameterId: "BEH-WARMTH",
          callerIdentityId: "ci-1",
          targetValue: 0.6,
          confidence: 1.0,
          source: "MANUAL",
          updatedAt: new Date(),
          parameter: { name: "Warmth", definition: "..." },
        },
        {
          id: "bt-2",
          parameterId: "BEH-WARMTH",
          callerIdentityId: "ci-2",
          targetValue: 0.85,
          confidence: 1.0,
          source: "MANUAL",
          updatedAt: new Date(),
          parameter: { name: "Warmth", definition: "..." },
        },
      ]);
      const raw = await executeAdminTool(
        "list_behavior_targets",
        { caller_id: "c-1" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.scope).toBe("CALLER");
      expect(result.count).toBe(1);
      expect(result.targets[0].targetValue).toBe(0.85);
    });

    it("errors when neither id given", async () => {
      const raw = await executeAdminTool("list_behavior_targets", {}, "OPERATOR");
      const result = JSON.parse(raw);
      expect(result.error).toMatch(/playbook_id.*caller_id/);
    });

    it("errors when both ids given", async () => {
      const raw = await executeAdminTool(
        "list_behavior_targets",
        { playbook_id: "pb-1", caller_id: "c-1" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.error).toMatch(/only one/);
    });
  });

  describe("list_curriculum_modules", () => {
    it("resolves curriculum from playbook_id", async () => {
      // #1177 Slice 6 — canonical PlaybookCurriculum join (no deprecated FK).
      mockPrisma.playbookCurriculum.findFirst.mockResolvedValueOnce({ curriculumId: "curr-1" });
      mockPrisma.curriculumModule.findMany.mockResolvedValue([
        {
          id: "m-1",
          slug: "MOD-1",
          title: "Intro",
          description: null,
          sortOrder: 0,
          isActive: true,
          estimatedDurationMinutes: 30,
          masteryThreshold: null,
          learningObjectives: [
            { id: "lo-1", ref: "LO1", description: "Recall x", learnerVisible: true },
          ],
        },
      ]);
      const raw = await executeAdminTool(
        "list_curriculum_modules",
        { playbook_id: "pb-1" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.ok).toBe(true);
      expect(result.curriculum_id).toBe("curr-1");
      expect(result.modules[0].learningObjectives[0].ref).toBe("LO1");
    });

    it("returns note when playbook has no curriculum yet", async () => {
      mockPrisma.playbookCurriculum.findFirst.mockResolvedValueOnce(null);
      const raw = await executeAdminTool(
        "list_curriculum_modules",
        { playbook_id: "pb-1" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.count).toBe(0);
      expect(result.note).toMatch(/No Curriculum/);
    });
  });

  describe("list_goals_for_caller", () => {
    it("returns goals sorted + optionally filtered by status", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([
        {
          id: "g-1",
          name: "Master matrices",
          type: "LEARN",
          status: "ACTIVE",
          progress: 0.4,
          priority: 5,
          isAssessmentTarget: true,
          startedAt: new Date(),
          completedAt: null,
          createdAt: new Date(),
        },
      ]);
      const raw = await executeAdminTool(
        "list_goals_for_caller",
        { caller_id: "c-1", status: "ACTIVE" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.count).toBe(1);
      expect(result.goals[0].progress).toBe(0.4);
      expect(mockPrisma.goal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { callerId: "c-1", status: "ACTIVE" } }),
      );
    });
  });

  describe("recompose_caller_prompt", () => {
    it("delegates to composition stack + returns new ComposedPrompt", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "c-1",
        name: "Anna",
        domainId: "d-1",
      });
      const raw = await executeAdminTool(
        "recompose_caller_prompt",
        { caller_id: "c-1", reason: "post-config edit" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.ok).toBe(true);
      expect(result.composed_prompt_id).toBe("cp-1");
      expect(result.composed_at).toBeDefined();
    });
  });

  describe("update_learning_objective", () => {
    it("updates LO + bumps owning playbook", async () => {
      mockPrisma.learningObjective.findUnique.mockResolvedValue({
        id: "lo-1",
        ref: "LO1",
        moduleId: "m-1",
        module: { curriculumId: "curr-1" },
      });
      mockPrisma.learningObjective.update.mockResolvedValue({
        id: "lo-1",
        ref: "LO1",
        description: "new",
        performanceStatement: null,
        learnerVisible: true,
        masteryThreshold: null,
      });
      // #1205 batch 4 — bump-fanout via canonical join (no curriculum.playbookId).
      mockPrisma.playbookCurriculum.findMany.mockResolvedValueOnce([{ playbookId: "pb-1" }]);

      const raw = await executeAdminTool(
        "update_learning_objective",
        { learning_objective_id: "lo-1", description: "new", reason: "rephrase" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.ok).toBe(true);
      expect(result.compose_inputs_bumped).toBe(true);
      expect(mockPrisma.playbook.update).toHaveBeenCalled();
    });

    it("validates at least one field passed", async () => {
      mockPrisma.learningObjective.findUnique.mockResolvedValue({
        id: "lo-1",
        ref: "LO1",
        moduleId: "m-1",
        module: { curriculumId: "curr-1" },
      });
      const raw = await executeAdminTool(
        "update_learning_objective",
        { learning_objective_id: "lo-1", reason: "x" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.error).toMatch(/No update fields/);
    });
  });

  describe("update_curriculum_metadata", () => {
    it("updates curriculum + bumps owning playbook", async () => {
      mockPrisma.curriculum.findUnique.mockResolvedValue({
        id: "curr-1",
        name: "Old",
      });
      mockPrisma.curriculum.update.mockResolvedValue({
        id: "curr-1",
        name: "New",
        description: null,
        sourceTitle: null,
        sourceYear: null,
        authors: [],
      });
      // #1205 batch 4 — bump-fanout resolves owning playbooks via the
      // canonical PlaybookCurriculum join (no Curriculum.playbookId fallback).
      mockPrisma.playbookCurriculum.findMany.mockResolvedValueOnce([{ playbookId: "pb-1" }]);

      const raw = await executeAdminTool(
        "update_curriculum_metadata",
        { curriculum_id: "curr-1", name: "New", reason: "rename" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.ok).toBe(true);
      expect(result.compose_inputs_bumped).toBe(true);
    });
  });

  describe("RBAC", () => {
    it("STUDENT cannot use any of the new read/write tools", async () => {
      for (const tool of [
        "get_playbook_config",
        "list_behavior_targets",
        "list_curriculum_modules",
        "list_goals_for_caller",
        "recompose_caller_prompt",
        "update_learning_objective",
        "update_curriculum_metadata",
      ]) {
        const raw = await executeAdminTool(
          tool,
          { caller_id: "x", playbook_id: "x", curriculum_id: "x", learning_objective_id: "x", reason: "x" },
          "STUDENT",
        );
        const result = JSON.parse(raw);
        expect(result.error).toMatch(/Insufficient permissions/);
      }
    });
  });

  // #1348 — Cascade Lens v1: read-only voice explainer tool.
  describe("explain_voice_cascade", () => {
    it("OPERATOR with valid callerId returns the VoiceCascadeExplanation", async () => {
      vi.doMock("@/lib/cascade/voice-explain", () => ({
        explainVoiceCascade: vi.fn(async (callerId: string) => ({
          cascade: "voice",
          callerId,
          playbookId: "pb-1",
          courseId: "pb-1",
          providerId: "vp-1",
          resolvedAt: new Date("2026-06-08").toISOString(),
          fields: [
            {
              key: "voiceId",
              resolvedValue: "asteria",
              winningSource: "provider",
              locked: false,
              chain: [
                { layer: "system", value: null, present: false },
                { layer: "provider", value: "asteria", present: true },
                { layer: "domain", value: null, present: false },
                { layer: "course", value: null, present: false },
              ],
            },
          ],
        })),
      }));
      vi.resetModules();
      const { executeAdminTool: fresh } = await import(
        "@/lib/chat/admin-tool-handlers"
      );

      const raw = await fresh(
        "explain_voice_cascade",
        { callerId: "c-1" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.ok).toBe(true);
      expect(result.explanation.cascade).toBe("voice");
      expect(result.explanation.callerId).toBe("c-1");
      expect(result.explanation.fields[0].key).toBe("voiceId");
    });

    it("STUDENT is refused with Insufficient permissions", async () => {
      const raw = await executeAdminTool(
        "explain_voice_cascade",
        { callerId: "c-1" },
        "STUDENT",
      );
      const result = JSON.parse(raw);
      expect(result.error).toMatch(/Insufficient permissions/);
    });
  });
});
