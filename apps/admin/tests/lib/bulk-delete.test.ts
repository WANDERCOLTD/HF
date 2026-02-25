/**
 * Tests for Bulk Delete infrastructure.
 *
 * Tests:
 *   - deletePlaybookData() — FK relationship handling + count tracking
 *   - deleteSubjectData() + findOrphanedSources() — FK + orphan detection
 *   - bulk-delete module — type exports, thresholds, dispatch helpers
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// =====================================================
// MOCK SETUP (vi.hoisted for proper hoisting)
// =====================================================

const makeMockModel = () => ({
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  delete: vi.fn().mockResolvedValue({}),
  findMany: vi.fn().mockResolvedValue([]),
  findFirst: vi.fn().mockResolvedValue(null),
  findUnique: vi.fn().mockResolvedValue(null),
  count: vi.fn().mockResolvedValue(0),
  update: vi.fn().mockResolvedValue({}),
});

const MODEL_NAMES = [
  "callerPlaybook",
  "cohortPlaybook",
  "goal",
  "call",
  "composedPrompt",
  "behaviorTarget",
  "invite",
  "playbook",
  "playbookItem",
  "playbookSubject",
  "curriculum",
  "subjectSource",
  "subjectDomain",
  "subjectMedia",
  "subject",
  "contentSource",
  "domain",
  "caller",
  "callerCohortMembership",
  "callMessage",
  "callAction",
  "conversationArtifact",
  "callerMemorySummary",
  "personalityObservation",
  "callerAttribute",
  "callerMemory",
  "behaviorMeasurement",
  "agentOnboarding",
  "composedSection",
  "behaviorTarget",
  "cohortGroup",
];

const mockModels = vi.hoisted(() => {
  const models: Record<string, any> = {};
  return models;
});

// Initialize models
for (const name of MODEL_NAMES) {
  mockModels[name] = makeMockModel();
}
mockModels.$transaction = vi.fn(async (fn: any) => fn(mockModels));

vi.mock("@/lib/prisma", () => ({
  prisma: mockModels,
}));

// Mock deleteCallerData used by bulk-delete.ts
vi.mock("@/lib/gdpr/delete-caller-data", async (importOriginal) => {
  return {
    deleteCallerData: vi.fn().mockResolvedValue({
      calls: 0, memories: 0, observations: 0, goals: 0,
      artifacts: 0, prompts: 0, enrollments: 0, targets: 0,
      attributes: 0, actions: 0, messages: 0, onboarding: 0, cohorts: 0,
      callerPlaybooks: 0, callActions: 0, callMessages: 0,
    }),
  };
});

// =====================================================
// IMPORT AFTER MOCKING
// =====================================================

import { deletePlaybookData, type PlaybookDeletionCounts } from "@/lib/gdpr/delete-playbook-data";
import { deleteSubjectData, findOrphanedSources, type SubjectDeletionCounts } from "@/lib/gdpr/delete-subject-data";
import {
  type EntityType,
  getPreviewFn,
  getExecuteFn,
  getSyncLimit,
} from "@/lib/admin/bulk-delete";

// =====================================================
// HELPERS
// =====================================================

function resetAllMocks() {
  for (const name of MODEL_NAMES) {
    if (mockModels[name]) {
      Object.values(mockModels[name]).forEach((fn: any) => {
        if (typeof fn?.mockReset === "function") {
          fn.mockReset();
          // Re-set defaults
          if (fn === mockModels[name].deleteMany || fn === mockModels[name].updateMany) {
            fn.mockResolvedValue({ count: 0 });
          } else if (fn === mockModels[name].delete || fn === mockModels[name].update) {
            fn.mockResolvedValue({});
          } else if (fn === mockModels[name].findMany) {
            fn.mockResolvedValue([]);
          } else if (fn === mockModels[name].findFirst || fn === mockModels[name].findUnique) {
            fn.mockResolvedValue(null);
          } else if (fn === mockModels[name].count) {
            fn.mockResolvedValue(0);
          }
        }
      });
    }
  }
  mockModels.$transaction.mockImplementation(async (fn: any) => fn(mockModels));
}

// =====================================================
// deletePlaybookData()
// =====================================================

describe("deletePlaybookData()", () => {
  beforeEach(resetAllMocks);

  it("deletes required FK join tables first", async () => {
    mockModels.callerPlaybook.deleteMany.mockResolvedValue({ count: 3 });
    mockModels.cohortPlaybook.deleteMany.mockResolvedValue({ count: 2 });

    const counts = await deletePlaybookData("pb-1");

    expect(counts.callerPlaybooks).toBe(3);
    expect(counts.cohortPlaybooks).toBe(2);
    expect(mockModels.callerPlaybook.deleteMany).toHaveBeenCalledWith({ where: { playbookId: "pb-1" } });
    expect(mockModels.cohortPlaybook.deleteMany).toHaveBeenCalledWith({ where: { playbookId: "pb-1" } });
  });

  it("nullifies nullable FKs instead of deleting parent records", async () => {
    mockModels.goal.updateMany.mockResolvedValue({ count: 5 });
    mockModels.call.updateMany.mockResolvedValue({ count: 10 });
    mockModels.composedPrompt.updateMany.mockResolvedValue({ count: 2 });
    mockModels.behaviorTarget.updateMany.mockResolvedValue({ count: 1 });
    mockModels.invite.updateMany.mockResolvedValue({ count: 0 });

    const counts = await deletePlaybookData("pb-1");

    expect(counts.goalsNullified).toBe(5);
    expect(counts.callsNullified).toBe(10);
    expect(counts.composedPromptsNullified).toBe(2);
    expect(counts.behaviorTargetsNullified).toBe(1);
    expect(counts.invitesNullified).toBe(0);

    // Verify SET NULL, not delete
    expect(mockModels.goal.updateMany).toHaveBeenCalledWith({
      where: { playbookId: "pb-1" },
      data: { playbookId: null },
    });
  });

  it("nullifies self-referential child versions", async () => {
    mockModels.playbook.updateMany.mockResolvedValue({ count: 2 });

    const counts = await deletePlaybookData("pb-1");

    expect(counts.childVersionsNullified).toBe(2);
    expect(mockModels.playbook.updateMany).toHaveBeenCalledWith({
      where: { parentVersionId: "pb-1" },
      data: { parentVersionId: null },
    });
  });

  it("deletes cascade-covered tables and tracks counts", async () => {
    mockModels.playbookItem.deleteMany.mockResolvedValue({ count: 15 });
    mockModels.playbookSubject.deleteMany.mockResolvedValue({ count: 3 });

    const counts = await deletePlaybookData("pb-1");

    expect(counts.playbookItems).toBe(15);
    expect(counts.playbookSubjects).toBe(3);
  });

  it("deletes the playbook itself last", async () => {
    const callOrder: string[] = [];
    mockModels.callerPlaybook.deleteMany.mockImplementation(async () => { callOrder.push("callerPlaybook"); return { count: 0 }; });
    mockModels.playbook.delete.mockImplementation(async () => { callOrder.push("playbook.delete"); return {}; });
    mockModels.playbookItem.deleteMany.mockImplementation(async () => { callOrder.push("playbookItem"); return { count: 0 }; });

    await deletePlaybookData("pb-1");

    // playbook.delete should be AFTER callerPlaybook and playbookItem
    expect(callOrder.indexOf("playbook.delete")).toBeGreaterThan(callOrder.indexOf("callerPlaybook"));
    expect(callOrder.indexOf("playbook.delete")).toBeGreaterThan(callOrder.indexOf("playbookItem"));
  });

  it("accepts optional transaction client", async () => {
    mockModels.$transaction.mockClear();

    // Create a custom tx that mimics prisma client models
    const customTx: Record<string, any> = {};
    for (const name of MODEL_NAMES) {
      customTx[name] = {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        delete: vi.fn().mockResolvedValue({}),
      };
    }

    await deletePlaybookData("pb-1", customTx as any);

    // $transaction should not be called when tx is provided
    expect(mockModels.$transaction).not.toHaveBeenCalled();
    // But the custom tx's methods should be called
    expect(customTx.callerPlaybook.deleteMany).toHaveBeenCalled();
  });

  it("returns complete count object with all fields", async () => {
    const counts = await deletePlaybookData("pb-1");

    expect(counts).toHaveProperty("callerPlaybooks");
    expect(counts).toHaveProperty("cohortPlaybooks");
    expect(counts).toHaveProperty("goalsNullified");
    expect(counts).toHaveProperty("callsNullified");
    expect(counts).toHaveProperty("composedPromptsNullified");
    expect(counts).toHaveProperty("behaviorTargetsNullified");
    expect(counts).toHaveProperty("invitesNullified");
    expect(counts).toHaveProperty("childVersionsNullified");
    expect(counts).toHaveProperty("playbookItems");
    expect(counts).toHaveProperty("playbookSubjects");
  });
});

// =====================================================
// deleteSubjectData()
// =====================================================

describe("deleteSubjectData()", () => {
  beforeEach(resetAllMocks);

  it("nullifies Curriculum.subjectId (SET NULL)", async () => {
    mockModels.curriculum.updateMany.mockResolvedValue({ count: 4 });

    const counts = await deleteSubjectData("sub-1");

    expect(counts.curriculaNullified).toBe(4);
    expect(mockModels.curriculum.updateMany).toHaveBeenCalledWith({
      where: { subjectId: "sub-1" },
      data: { subjectId: null },
    });
  });

  it("deletes all junction tables", async () => {
    mockModels.subjectSource.deleteMany.mockResolvedValue({ count: 5 });
    mockModels.subjectDomain.deleteMany.mockResolvedValue({ count: 2 });
    mockModels.playbookSubject.deleteMany.mockResolvedValue({ count: 3 });
    mockModels.subjectMedia.deleteMany.mockResolvedValue({ count: 1 });

    const counts = await deleteSubjectData("sub-1");

    expect(counts.subjectSources).toBe(5);
    expect(counts.subjectDomains).toBe(2);
    expect(counts.playbookSubjects).toBe(3);
    expect(counts.subjectMedia).toBe(1);
  });

  it("deletes the subject itself last", async () => {
    const callOrder: string[] = [];
    mockModels.subjectSource.deleteMany.mockImplementation(async () => { callOrder.push("subjectSource"); return { count: 0 }; });
    mockModels.subject.delete.mockImplementation(async () => { callOrder.push("subject.delete"); return {}; });

    await deleteSubjectData("sub-1");

    expect(callOrder.indexOf("subject.delete")).toBeGreaterThan(callOrder.indexOf("subjectSource"));
  });

  it("returns complete count object", async () => {
    const counts = await deleteSubjectData("sub-1");

    expect(counts).toHaveProperty("curriculaNullified");
    expect(counts).toHaveProperty("subjectSources");
    expect(counts).toHaveProperty("subjectDomains");
    expect(counts).toHaveProperty("playbookSubjects");
    expect(counts).toHaveProperty("subjectMedia");
  });
});

// =====================================================
// findOrphanedSources()
// =====================================================

describe("findOrphanedSources()", () => {
  beforeEach(resetAllMocks);

  it("returns source IDs only linked to the given subjects", async () => {
    // First call: sources linked to subject being deleted
    mockModels.subjectSource.findMany
      .mockResolvedValueOnce([
        { sourceId: "src-1" },
        { sourceId: "src-2" },
        { sourceId: "src-3" },
      ])
      // Second call: sources shared with OTHER subjects (src-2 is shared)
      .mockResolvedValueOnce([
        { sourceId: "src-2" },
      ]);

    const orphans = await findOrphanedSources(["sub-1"]);

    expect(orphans).toEqual(["src-1", "src-3"]);
  });

  it("returns empty array when no sources are linked", async () => {
    mockModels.subjectSource.findMany.mockResolvedValue([]);

    const orphans = await findOrphanedSources(["sub-1"]);

    expect(orphans).toEqual([]);
  });
});

// =====================================================
// Bulk Delete Module
// =====================================================

describe("bulk-delete module", () => {
  describe("getSyncLimit()", () => {
    it("returns correct limits for each entity type", () => {
      expect(getSyncLimit("caller")).toBe(5);
      expect(getSyncLimit("playbook")).toBe(10);
      expect(getSyncLimit("subject")).toBe(10);
      expect(getSyncLimit("domain")).toBe(20);
    });
  });

  describe("getPreviewFn()", () => {
    it("returns a function for each entity type", () => {
      expect(typeof getPreviewFn("caller")).toBe("function");
      expect(typeof getPreviewFn("playbook")).toBe("function");
      expect(typeof getPreviewFn("domain")).toBe("function");
      expect(typeof getPreviewFn("subject")).toBe("function");
    });
  });

  describe("getExecuteFn()", () => {
    it("returns a function for each entity type", () => {
      expect(typeof getExecuteFn("caller")).toBe("function");
      expect(typeof getExecuteFn("playbook")).toBe("function");
      expect(typeof getExecuteFn("domain")).toBe("function");
      expect(typeof getExecuteFn("subject")).toBe("function");
    });
  });

  describe("type exports", () => {
    it("EntityType covers all 4 entities", () => {
      const types: EntityType[] = ["caller", "playbook", "domain", "subject"];
      expect(types).toHaveLength(4);
    });
  });
});
