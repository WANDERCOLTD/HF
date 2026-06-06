/**
 * Tests for Cmd+K coverage-gap closures — Domain compose fields routing,
 * curriculum/LO edits, goal confirm/dismiss.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  domain: { findUnique: vi.fn(), update: vi.fn() },
  curriculumModule: { findUnique: vi.fn(), update: vi.fn() },
  contentAssertion: { update: vi.fn() },
  learningObjective: { findUnique: vi.fn() },
  playbook: { update: vi.fn() },
  playbookSource: { findMany: vi.fn() },
  curriculum: { findUnique: vi.fn() },
  caller: { update: vi.fn() },
  goal: { findUnique: vi.fn(), update: vi.fn() },
  callerAttribute: { findFirst: vi.fn(), update: vi.fn() },
  // Added 2026-06-04: peer #1034's bump-curriculum-fanout helper +
  // resolve-* read prisma.playbookCurriculum. Without this the
  // update_curriculum_module tool 500s in this test. findMany returns
  // [] so the fanout helper's `.length` access doesn't NPE.
  playbookCurriculum: {
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("Cmd+K coverage-gap fixes", () => {
  let executeAdminTool: typeof import("@/lib/chat/admin-tool-handlers").executeAdminTool;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/lib/chat/admin-tool-handlers");
    executeAdminTool = mod.executeAdminTool;
    mockPrisma.playbook.update.mockResolvedValue({ id: "pb-1" });
    mockPrisma.caller.update.mockResolvedValue({ id: "c-1" });
  });

  describe("update_domain — onboarding compose fields", () => {
    it("routes onboarding* fields through updateDomainConfig and bumps the domain timestamp", async () => {
      mockPrisma.domain.findUnique
        .mockResolvedValueOnce({ id: "d-1", name: "ESL", config: null }) // initial existence check
        .mockResolvedValueOnce({
          // updateDomainConfig's findUnique
          onboardingFlowPhases: null,
          onboardingDefaultTargets: null,
          onboardingWelcome: null,
          onboardingIdentitySpecId: null,
        })
        .mockResolvedValueOnce({
          id: "d-1",
          name: "ESL",
          slug: "esl",
          description: null,
          isActive: true,
          config: null,
          onboardingFlowPhases: null,
          onboardingDefaultTargets: null,
          onboardingWelcome: "Hello!",
          onboardingIdentitySpecId: null,
        });
      mockPrisma.domain.update.mockImplementation(async ({ data, where }) => ({
        id: where.id,
        ...data,
      }));

      const raw = await executeAdminTool(
        "update_domain",
        { domain_id: "d-1", onboardingWelcome: "Hello!", reason: "test" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);

      expect(result.ok).toBe(true);
      expect(result.compose_inputs_bumped).toBe(true);
      expect(mockPrisma.domain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "d-1" },
          data: expect.objectContaining({ composeInputsUpdatedAt: expect.any(Date) }),
        }),
      );
    });

    it("rejects with helpful error when no update fields provided", async () => {
      mockPrisma.domain.findUnique.mockResolvedValueOnce({ id: "d-1", name: "ESL", config: null });
      const raw = await executeAdminTool(
        "update_domain",
        { domain_id: "d-1", reason: "test" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.error).toMatch(/No update fields/);
    });
  });

  describe("update_curriculum_module", () => {
    it("updates module + bumps owning playbook stale", async () => {
      mockPrisma.curriculumModule.findUnique.mockResolvedValue({
        id: "m-1",
        slug: "MOD-1",
        title: "Old",
        curriculumId: "c-1",
      });
      mockPrisma.curriculumModule.update.mockResolvedValue({
        id: "m-1",
        slug: "MOD-1",
        title: "New",
        description: null,
        sortOrder: 0,
        isActive: true,
        estimatedDurationMinutes: null,
        masteryThreshold: null,
      });
      // #1205 batch 4 — bump-fanout via canonical join (no curriculum.playbookId).
      mockPrisma.playbookCurriculum.findMany.mockResolvedValueOnce([{ playbookId: "pb-1" }]);

      const raw = await executeAdminTool(
        "update_curriculum_module",
        { module_id: "m-1", title: "New", reason: "rename" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);

      expect(result.ok).toBe(true);
      expect(result.playbook_id).toBe("pb-1");
      expect(result.compose_inputs_bumped).toBe(true);
      expect(mockPrisma.playbook.update).toHaveBeenCalledWith({
        where: { id: "pb-1" },
        data: { composeInputsUpdatedAt: expect.any(Date) },
      });
    });

    it("returns error when no editable fields passed", async () => {
      mockPrisma.curriculumModule.findUnique.mockResolvedValue({
        id: "m-1",
        slug: "MOD-1",
        title: "X",
        curriculumId: "c-1",
      });

      const raw = await executeAdminTool(
        "update_curriculum_module",
        { module_id: "m-1", reason: "x" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.error).toMatch(/No update fields/);
    });
  });

  describe("update_assertion_lo_link", () => {
    it("links assertion to LO + fans out playbook bumps via PlaybookSource", async () => {
      mockPrisma.learningObjective.findUnique.mockResolvedValue({
        id: "lo-1",
        ref: "LO-1",
      });
      mockPrisma.contentAssertion.update.mockResolvedValue({
        id: "a-1",
        sourceId: "src-1",
        learningObjectiveId: "lo-1",
        learningOutcomeRef: "LO-1",
        linkConfidence: 1.0,
      });
      mockPrisma.playbookSource.findMany.mockResolvedValue([
        { playbookId: "pb-A" },
        { playbookId: "pb-B" },
      ]);

      const raw = await executeAdminTool(
        "update_assertion_lo_link",
        { assertion_id: "a-1", learning_objective_id: "lo-1", reason: "verify" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);

      expect(result.ok).toBe(true);
      expect(result.playbooks_bumped).toBe(2);
      expect(mockPrisma.playbook.update).toHaveBeenCalledTimes(2);
    });

    it("clears link when learning_objective_id is null", async () => {
      mockPrisma.contentAssertion.update.mockResolvedValue({
        id: "a-1",
        sourceId: "src-1",
        learningObjectiveId: null,
        learningOutcomeRef: null,
        linkConfidence: null,
      });
      mockPrisma.playbookSource.findMany.mockResolvedValue([{ playbookId: "pb-A" }]);

      const raw = await executeAdminTool(
        "update_assertion_lo_link",
        { assertion_id: "a-1", learning_objective_id: null, reason: "miscategorised" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.ok).toBe(true);
      expect(result.new_state.learningObjectiveId).toBeNull();
    });
  });

  describe("confirm_goal / dismiss_goal", () => {
    it("confirm_goal marks goal COMPLETED + bumps caller stale", async () => {
      mockPrisma.goal.findUnique.mockResolvedValue({
        id: "g-1",
        name: "Master matrices",
        callerId: "c-1",
        isAssessmentTarget: false,
        status: "ACTIVE",
      });
      mockPrisma.callerAttribute.findFirst.mockResolvedValue({ id: "ca-sig" });
      mockPrisma.goal.update.mockResolvedValue({
        status: "COMPLETED",
        completedAt: new Date(),
        progress: 1.0,
      });

      const raw = await executeAdminTool(
        "confirm_goal",
        { goal_id: "g-1", reason: "manual" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);

      expect(result.ok).toBe(true);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "g-1" },
        data: expect.objectContaining({ status: "COMPLETED", progress: 1.0 }),
      });
      expect(mockPrisma.callerAttribute.update).toHaveBeenCalledWith({
        where: { id: "ca-sig" },
        data: { booleanValue: true },
      });
      expect(mockPrisma.caller.update).toHaveBeenCalledWith({
        where: { id: "c-1" },
        data: { composeInputsUpdatedAt: expect.any(Date) },
      });
    });

    it("dismiss_goal flips signal false + bumps caller stale", async () => {
      mockPrisma.goal.findUnique.mockResolvedValue({
        id: "g-1",
        name: "X",
        callerId: "c-1",
      });
      mockPrisma.callerAttribute.findFirst.mockResolvedValue({ id: "ca-sig" });

      const raw = await executeAdminTool(
        "dismiss_goal",
        { goal_id: "g-1", reason: "still active" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);

      expect(result.ok).toBe(true);
      expect(mockPrisma.callerAttribute.update).toHaveBeenCalledWith({
        where: { id: "ca-sig" },
        data: { booleanValue: false },
      });
      expect(mockPrisma.caller.update).toHaveBeenCalledWith({
        where: { id: "c-1" },
        data: { composeInputsUpdatedAt: expect.any(Date) },
      });
    });

    it("dismiss_goal errors when no pending signal exists", async () => {
      mockPrisma.goal.findUnique.mockResolvedValue({
        id: "g-1",
        name: "X",
        callerId: "c-1",
      });
      mockPrisma.callerAttribute.findFirst.mockResolvedValue(null);

      const raw = await executeAdminTool(
        "dismiss_goal",
        { goal_id: "g-1", reason: "noop" },
        "OPERATOR",
      );
      const result = JSON.parse(raw);
      expect(result.error).toMatch(/No pending completion signal/);
    });
  });

  describe("RBAC", () => {
    it("STUDENT cannot use any of the new write tools", async () => {
      for (const tool of [
        "update_curriculum_module",
        "update_assertion_lo_link",
        "confirm_goal",
        "dismiss_goal",
      ]) {
        const raw = await executeAdminTool(tool, { reason: "x" }, "STUDENT");
        const result = JSON.parse(raw);
        expect(result.error).toMatch(/Insufficient permissions/);
      }
    });
  });
});
