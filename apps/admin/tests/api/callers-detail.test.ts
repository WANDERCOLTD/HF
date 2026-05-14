/**
 * Tests for /api/callers/[callerId] endpoint
 *
 * GET: Comprehensive caller data (profile, personality, memories, calls, scores, goals, etc.)
 * PATCH: Update caller fields (name, email, phone, domainId with domain-switch logic)
 * DELETE: Delete caller and all associated data, optional exclusion
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  caller: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  callerPersonalityProfile: {
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
  },
  personalityObservation: {
    findMany: vi.fn(),
    count: vi.fn(),
    deleteMany: vi.fn(),
  },
  callerMemory: {
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    deleteMany: vi.fn(),
  },
  callerMemorySummary: {
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
  },
  call: {
    findMany: vi.fn(),
    count: vi.fn(),
    deleteMany: vi.fn(),
  },
  callerIdentity: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
  },
  callScore: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  callerTarget: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  behaviorTarget: {
    count: vi.fn(),
  },
  behaviorMeasurement: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  composedPrompt: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  conversationArtifact: {
    count: vi.fn(),
  },
  goal: {
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  playbook: {
    findFirst: vi.fn(),
  },
  domain: {
    findUnique: vi.fn(),
  },
  excludedCaller: {
    upsert: vi.fn(),
  },
  callerPersonality: {
    deleteMany: vi.fn(),
  },
  promptSlugSelection: {
    deleteMany: vi.fn(),
  },
  callerAttribute: {
    deleteMany: vi.fn(),
  },
  callTarget: {
    deleteMany: vi.fn(),
  },
  rewardScore: {
    deleteMany: vi.fn(),
  },
  onboardingSession: {
    upsert: vi.fn(),
  },
  analysisSpec: {
    findFirst: vi.fn(),
  },
  callAction: {
    count: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

// Mock external lib dependencies used by the caller detail GET route
vi.mock("@/lib/prompt/compose-content-section", () => ({
  composeContentSection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/learner/profile", () => ({
  getLearnerProfile: vi.fn().mockResolvedValue(null),
}));

// Mock GDPR deletion utility
const mockDeleteCallerData = vi.fn().mockResolvedValue({
  callScores: 0, behaviorMeasurements: 0, callTargets: 0, rewardScores: 0,
  callerMemories: 0, callerMemorySummaries: 0, personalityObservations: 0,
  callerPersonalities: 0, callerPersonalityProfiles: 0, promptSlugSelections: 0,
  composedPrompts: 0, callerTargets: 0, callerAttributes: 0, callerIdentities: 0,
  goals: 0, artifacts: 0, inboundMessages: 0, onboardingSessions: 0, calls: 0,
});
vi.mock("@/lib/gdpr/delete-caller-data", () => ({
  deleteCallerData: mockDeleteCallerData,
}));

// Mock audit logging
const mockAuditLog = vi.fn();
vi.mock("@/lib/audit", () => ({
  auditLog: mockAuditLog,
  AuditAction: {
    DELETED_CALLER: "deleted_caller",
    EXPORTED_CALLER_DATA: "exported_caller_data",
    RETENTION_CLEANUP: "retention_cleanup",
  },
}));

// Override access-control mock to include buildScopeFilter
vi.mock("@/lib/access-control", () => ({
  requireEntityAccess: vi.fn().mockResolvedValue({
    session: {
      user: { id: "test-user", email: "test@example.com", name: "Test User", role: "ADMIN", image: null },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
    scope: "ALL",
  }),
  isEntityAuthError: vi.fn().mockReturnValue(false),
  buildScopeFilter: vi.fn().mockReturnValue({}),
}));

// =====================================================
// HELPERS
// =====================================================

function makeParams(callerId: string) {
  return { params: Promise.resolve({ callerId }) };
}

function createTxMock() {
  return {
    call: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    callScore: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    behaviorMeasurement: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    callTarget: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    rewardScore: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    callerMemory: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    callerMemorySummary: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    personalityObservation: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    callerPersonality: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    callerPersonalityProfile: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    promptSlugSelection: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    composedPrompt: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    callerTarget: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    callerAttribute: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    callerIdentity: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    caller: { delete: vi.fn().mockResolvedValue({}) },
  };
}

function setupGetMocks(callerData: any) {
  // caller.findUnique is called multiple times: main query, curriculum IIFE, counts section
  mockPrisma.caller.findUnique.mockResolvedValue(callerData);

  mockPrisma.callerPersonalityProfile.findUnique.mockResolvedValue(null);
  mockPrisma.personalityObservation.findMany.mockResolvedValue([]);
  mockPrisma.personalityObservation.count.mockResolvedValue(0);
  mockPrisma.callerMemory.findMany.mockResolvedValue([]);
  mockPrisma.callerMemory.count.mockResolvedValue(0);
  mockPrisma.callerMemory.groupBy.mockResolvedValue([]);
  mockPrisma.callerMemorySummary.findUnique.mockResolvedValue(null);
  mockPrisma.call.findMany.mockResolvedValue([]);
  mockPrisma.call.count.mockResolvedValue(0);
  mockPrisma.callerIdentity.findMany.mockResolvedValue([]);
  mockPrisma.callerIdentity.findFirst.mockResolvedValue(null);
  mockPrisma.callScore.findMany.mockResolvedValue([]);
  mockPrisma.callerTarget.findMany.mockResolvedValue([]);
  mockPrisma.behaviorTarget.count.mockResolvedValue(0);
  mockPrisma.behaviorMeasurement.findMany.mockResolvedValue([]);
  mockPrisma.conversationArtifact.count.mockResolvedValue(0);
  mockPrisma.composedPrompt.findMany.mockResolvedValue([]);
  mockPrisma.goal.findMany.mockResolvedValue([]);
  mockPrisma.playbook.findFirst.mockResolvedValue(null);
  mockPrisma.callAction.count.mockResolvedValue(0);
}

// =====================================================
// TESTS
// =====================================================

describe("/api/callers/[callerId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ===================================================
  // GET /api/callers/[callerId]
  // ===================================================
  describe("GET", () => {
    it("should return comprehensive caller data for existing caller", async () => {
      const callerData = {
        id: "caller-1",
        name: "John Doe",
        email: "john@example.com",
        phone: "+123",
        externalId: "ext-1",
        role: "LEARNER",
        createdAt: new Date("2026-01-01"),
        domainId: "domain-1",
        cohortGroupId: null,
        domain: { id: "domain-1", slug: "test", name: "Test" },
        cohortGroup: null,
        cohortMemberships: [],
        ownedCohorts: [],
      };

      setupGetMocks(callerData);

      const { GET } = await import("../../app/api/callers/[callerId]/route");
      const request = new Request("http://localhost/api/callers/caller-1");
      const response = await GET(request, makeParams("caller-1"));
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.caller.id).toBe("caller-1");
      expect(data.caller.name).toBe("John Doe");
      expect(data.caller._count).toBeDefined();
      expect(data.counts).toBeDefined();
      expect(data.counts.calls).toBe(0);
      expect(data.counts.memories).toBe(0);
      expect(data.counts.observations).toBe(0);
    });

    it("should return 404 for non-existent caller", async () => {
      setupGetMocks(null);

      const { GET } = await import("../../app/api/callers/[callerId]/route");
      const request = new Request("http://localhost/api/callers/nonexistent");
      const response = await GET(request, makeParams("nonexistent"));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("Caller not found");
    });

    it("should include call status flags in response", async () => {
      const callerData = {
        id: "caller-1",
        name: "John",
        email: null,
        phone: null,
        externalId: "ext-1",
        role: "LEARNER",
        createdAt: new Date(),
        domainId: null,
        cohortGroupId: null,
        domain: null,
        cohortGroup: null,
        cohortMemberships: [],
        ownedCohorts: [],
      };

      setupGetMocks(callerData);

      // Override call.findMany to return calls with _count
      mockPrisma.call.findMany.mockResolvedValue([
        {
          id: "call-1",
          source: "sim",
          externalId: "ext-call-1",
          transcript: "Hello",
          createdAt: new Date(),
          callSequence: 1,
          _count: { scores: 3, behaviorMeasurements: 2 },
          rewardScore: { id: "rs-1" },
        },
      ]);
      mockPrisma.call.count.mockResolvedValue(1);

      const { GET } = await import("../../app/api/callers/[callerId]/route");
      const request = new Request("http://localhost/api/callers/caller-1");
      const response = await GET(request, makeParams("caller-1"));
      const data = await response.json();

      expect(data.calls).toHaveLength(1);
      expect(data.calls[0].hasScores).toBe(true);
      expect(data.calls[0].hasBehaviorMeasurements).toBe(true);
      expect(data.calls[0].hasRewardScore).toBe(true);
    });

    it("should return 500 on database error", async () => {
      mockPrisma.caller.findUnique.mockRejectedValue(new Error("Connection timeout"));

      const { GET } = await import("../../app/api/callers/[callerId]/route");
      const request = new Request("http://localhost/api/callers/caller-1");
      const response = await GET(request, makeParams("caller-1"));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.ok).toBe(false);
    });
  });

  // ===================================================
  // PATCH /api/callers/[callerId]
  // ===================================================
  describe("PATCH", () => {
    it("should update caller name", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        domainId: "domain-1",
        domainSwitchCount: 0,
      });
      mockPrisma.caller.update.mockResolvedValue({
        id: "caller-1",
        name: "Updated Name",
        email: null,
        phone: null,
        externalId: "ext-1",
        createdAt: new Date(),
        domainId: "domain-1",
        previousDomainId: null,
        domainSwitchCount: 0,
        domain: { id: "domain-1", slug: "test", name: "Test" },
      });

      const { PATCH } = await import("../../app/api/callers/[callerId]/route");
      const request = new Request("http://localhost/api/callers/caller-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Updated Name" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await PATCH(request, makeParams("caller-1"));
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.caller.name).toBe("Updated Name");
    });

    it("should return 404 when caller does not exist", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue(null);

      const { PATCH } = await import("../../app/api/callers/[callerId]/route");
      const request = new Request("http://localhost/api/callers/nonexistent", {
        method: "PATCH",
        body: JSON.stringify({ name: "Test" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await PATCH(request, makeParams("nonexistent"));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("Caller not found");
    });

    it("should return 400 when domainId is invalid", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        domainId: "domain-1",
        domainSwitchCount: 0,
      });
      mockPrisma.domain.findUnique.mockResolvedValue(null);

      const { PATCH } = await import("../../app/api/callers/[callerId]/route");
      const request = new Request("http://localhost/api/callers/caller-1", {
        method: "PATCH",
        body: JSON.stringify({ domainId: "nonexistent-domain" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await PATCH(request, makeParams("caller-1"));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("Domain not found");
    });

    it("should handle domain switch and archive old goals", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        domainId: "domain-old",
        domainSwitchCount: 0,
      });
      mockPrisma.domain.findUnique.mockResolvedValue({ id: "domain-new", slug: "new", name: "New" });
      mockPrisma.caller.update.mockResolvedValue({
        id: "caller-1",
        name: "John",
        email: null,
        phone: null,
        externalId: "ext-1",
        createdAt: new Date(),
        domainId: "domain-new",
        previousDomainId: "domain-old",
        domainSwitchCount: 1,
        domain: { id: "domain-new", slug: "new", name: "New" },
      });
      mockPrisma.goal.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.onboardingSession.upsert.mockResolvedValue({});
      mockPrisma.playbook.findFirst.mockResolvedValue(null);

      const { PATCH } = await import("../../app/api/callers/[callerId]/route");
      const request = new Request("http://localhost/api/callers/caller-1", {
        method: "PATCH",
        body: JSON.stringify({ domainId: "domain-new" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await PATCH(request, makeParams("caller-1"));
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.caller.domainId).toBe("domain-new");
      expect(mockPrisma.goal.updateMany).toHaveBeenCalledWith({
        where: {
          callerId: "caller-1",
          status: { in: ["ACTIVE", "PAUSED"] },
        },
        data: { status: "ARCHIVED" },
      });
      expect(mockPrisma.onboardingSession.upsert).toHaveBeenCalled();
    });

    it("should return 500 on database error", async () => {
      mockPrisma.caller.findUnique.mockRejectedValue(new Error("DB error"));

      const { PATCH } = await import("../../app/api/callers/[callerId]/route");
      const request = new Request("http://localhost/api/callers/caller-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Test" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await PATCH(request, makeParams("caller-1"));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.ok).toBe(false);
    });
  });

  // ===================================================
  // DELETE /api/callers/[callerId]
  // ===================================================
  describe("DELETE", () => {
    it("should delete a caller and return success", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        name: "John",
        phone: "+123",
        externalId: "ext-1",
      });

      const { DELETE } = await import("../../app/api/callers/[callerId]/route");
      const request = new Request("http://localhost/api/callers/caller-1", {
        method: "DELETE",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });
      const response = await DELETE(request, makeParams("caller-1"));
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.message).toContain("John");
      expect(data.excluded).toBeFalsy();
      expect(mockDeleteCallerData).toHaveBeenCalledWith("caller-1");
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "deleted_caller",
          entityType: "Caller",
          entityId: "caller-1",
        })
      );
    });

    it("should return 404 when caller does not exist", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue(null);

      const { DELETE } = await import("../../app/api/callers/[callerId]/route");
      const request = new Request("http://localhost/api/callers/nonexistent", {
        method: "DELETE",
      });
      const response = await DELETE(request, makeParams("nonexistent"));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("Caller not found");
    });

    it("should exclude caller when exclude=true and caller has identifiers", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        name: "John",
        phone: "+123",
        externalId: "ext-1",
      });
      mockPrisma.excludedCaller.upsert.mockResolvedValue({});

      const { DELETE } = await import("../../app/api/callers/[callerId]/route");
      const request = new Request("http://localhost/api/callers/caller-1", {
        method: "DELETE",
        body: JSON.stringify({ exclude: true }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await DELETE(request, makeParams("caller-1"));
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.excluded).toBeTruthy();
      expect(mockPrisma.excludedCaller.upsert).toHaveBeenCalledTimes(2);
    });

    it("should handle delete with no body gracefully", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        name: "John",
        phone: null,
        externalId: null,
      });

      const { DELETE } = await import("../../app/api/callers/[callerId]/route");
      const request = new Request("http://localhost/api/callers/caller-1", {
        method: "DELETE",
      });
      const response = await DELETE(request, makeParams("caller-1"));
      const data = await response.json();

      expect(data.ok).toBe(true);
    });

    it("should return 500 on database error", async () => {
      mockPrisma.caller.findUnique.mockRejectedValue(new Error("Transaction failed"));

      const { DELETE } = await import("../../app/api/callers/[callerId]/route");
      const request = new Request("http://localhost/api/callers/caller-1", {
        method: "DELETE",
      });
      const response = await DELETE(request, makeParams("caller-1"));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.ok).toBe(false);
    });
  });
});
