/**
 * Tests for /api/callers/:callerId/actions endpoints
 *
 * GET: List actions for a caller with optional filters.
 * POST: Create a manual action.
 * PATCH: Update action status/notes.
 * DELETE: Delete an action.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  caller: {
    findUnique: vi.fn(),
  },
  callAction: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

// =====================================================
// HELPERS
// =====================================================

function makeRequest(url: string, options?: RequestInit) {
  return new Request(url, options);
}

function makePostRequest(url: string, body: any) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(url: string, body: any) {
  return new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// =====================================================
// TESTS
// =====================================================

describe("/api/callers/:callerId/actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("GET", () => {
    it("should return actions for a caller with counts", async () => {
      const mockActions = [
        {
          id: "act-1",
          callId: "call-1",
          callerId: "caller-1",
          type: "HOMEWORK",
          title: "Practice times tables",
          assignee: "CALLER",
          status: "PENDING",
          priority: "MEDIUM",
          source: "EXTRACTED",
          confidence: 0.9,
          createdAt: new Date("2026-02-14"),
        },
      ];

      mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1" });
      mockPrisma.callAction.findMany.mockResolvedValue(mockActions);
      mockPrisma.callAction.count
        .mockResolvedValueOnce(1) // pending
        .mockResolvedValueOnce(0) // completed
        .mockResolvedValueOnce(1); // total

      const { GET } = await import(
        "@/app/api/callers/[callerId]/actions/route"
      );

      const request = makeRequest(
        "http://localhost:3000/api/callers/caller-1/actions"
      );
      const response = await GET(request as any, {
        params: Promise.resolve({ callerId: "caller-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.actions).toHaveLength(1);
      expect(data.actions[0].type).toBe("HOMEWORK");
      expect(data.counts.pending).toBe(1);
      expect(data.counts.total).toBe(1);
    });

    it("should filter by assignee", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1" });
      mockPrisma.callAction.findMany.mockResolvedValue([]);
      mockPrisma.callAction.count.mockResolvedValue(0);

      const { GET } = await import(
        "@/app/api/callers/[callerId]/actions/route"
      );

      const request = makeRequest(
        "http://localhost:3000/api/callers/caller-1/actions?assignee=AGENT"
      );
      await GET(request as any, {
        params: Promise.resolve({ callerId: "caller-1" }),
      });

      const findCall = mockPrisma.callAction.findMany.mock.calls[0][0];
      expect(findCall.where.assignee).toBe("AGENT");
    });

    it("should filter by status", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1" });
      mockPrisma.callAction.findMany.mockResolvedValue([]);
      mockPrisma.callAction.count.mockResolvedValue(0);

      const { GET } = await import(
        "@/app/api/callers/[callerId]/actions/route"
      );

      const request = makeRequest(
        "http://localhost:3000/api/callers/caller-1/actions?status=COMPLETED"
      );
      await GET(request as any, {
        params: Promise.resolve({ callerId: "caller-1" }),
      });

      const findCall = mockPrisma.callAction.findMany.mock.calls[0][0];
      expect(findCall.where.status).toBe("COMPLETED");
    });

    it("should return 404 for non-existent caller", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue(null);

      const { GET } = await import(
        "@/app/api/callers/[callerId]/actions/route"
      );

      const request = makeRequest(
        "http://localhost:3000/api/callers/nonexistent/actions"
      );
      const response = await GET(request as any, {
        params: Promise.resolve({ callerId: "nonexistent" }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.ok).toBe(false);
    });
  });

  describe("POST", () => {
    it("should create a manual action", async () => {
      const created = {
        id: "act-new",
        callerId: "caller-1",
        type: "TASK",
        title: "Send study guide",
        assignee: "OPERATOR",
        status: "PENDING",
        priority: "HIGH",
        source: "MANUAL",
        confidence: 1.0,
        createdAt: new Date(),
      };

      mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1" });
      mockPrisma.callAction.create.mockResolvedValue(created);

      const { POST } = await import(
        "@/app/api/callers/[callerId]/actions/route"
      );

      const request = makePostRequest(
        "http://localhost:3000/api/callers/caller-1/actions",
        {
          type: "TASK",
          title: "Send study guide",
          assignee: "OPERATOR",
          priority: "HIGH",
        }
      );
      const response = await POST(request as any, {
        params: Promise.resolve({ callerId: "caller-1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.ok).toBe(true);
      expect(data.action.type).toBe("TASK");
    });

    it("should reject missing title", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1" });

      const { POST } = await import(
        "@/app/api/callers/[callerId]/actions/route"
      );

      const request = makePostRequest(
        "http://localhost:3000/api/callers/caller-1/actions",
        {
          type: "TASK",
          assignee: "CALLER",
        }
      );
      const response = await POST(request as any, {
        params: Promise.resolve({ callerId: "caller-1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Title");
    });

    it("should reject invalid type", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1" });

      const { POST } = await import(
        "@/app/api/callers/[callerId]/actions/route"
      );

      const request = makePostRequest(
        "http://localhost:3000/api/callers/caller-1/actions",
        {
          type: "INVALID_TYPE",
          title: "Test",
          assignee: "CALLER",
        }
      );
      const response = await POST(request as any, {
        params: Promise.resolve({ callerId: "caller-1" }),
      });

      expect(response.status).toBe(400);
    });
  });
});

describe("/api/callers/:callerId/actions/:actionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("PATCH", () => {
    it("should update action status to COMPLETED", async () => {
      const existing = {
        id: "act-1",
        callerId: "caller-1",
        status: "PENDING",
      };
      const updated = {
        ...existing,
        status: "COMPLETED",
        completedAt: new Date(),
      };

      mockPrisma.callAction.findFirst.mockResolvedValue(existing);
      mockPrisma.callAction.update.mockResolvedValue(updated);

      const { PATCH } = await import(
        "@/app/api/callers/[callerId]/actions/[actionId]/route"
      );

      const request = makePatchRequest(
        "http://localhost:3000/api/callers/caller-1/actions/act-1",
        { status: "COMPLETED" }
      );
      const response = await PATCH(request as any, {
        params: Promise.resolve({ callerId: "caller-1", actionId: "act-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);

      // Check that completedAt was set
      const updateCall = mockPrisma.callAction.update.mock.calls[0][0];
      expect(updateCall.data.completedAt).toBeInstanceOf(Date);
      expect(updateCall.data.status).toBe("COMPLETED");
    });

    it("should return 404 for non-existent action", async () => {
      mockPrisma.callAction.findFirst.mockResolvedValue(null);

      const { PATCH } = await import(
        "@/app/api/callers/[callerId]/actions/[actionId]/route"
      );

      const request = makePatchRequest(
        "http://localhost:3000/api/callers/caller-1/actions/nonexistent",
        { status: "COMPLETED" }
      );
      const response = await PATCH(request as any, {
        params: Promise.resolve({ callerId: "caller-1", actionId: "nonexistent" }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE", () => {
    it("should delete an action", async () => {
      mockPrisma.callAction.findFirst.mockResolvedValue({
        id: "act-1",
        callerId: "caller-1",
      });
      mockPrisma.callAction.delete.mockResolvedValue({});

      const { DELETE } = await import(
        "@/app/api/callers/[callerId]/actions/[actionId]/route"
      );

      const request = makeRequest(
        "http://localhost:3000/api/callers/caller-1/actions/act-1",
        { method: "DELETE" }
      );
      const response = await DELETE(request as any, {
        params: Promise.resolve({ callerId: "caller-1", actionId: "act-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
    });

    it("should return 404 for non-existent action", async () => {
      mockPrisma.callAction.findFirst.mockResolvedValue(null);

      const { DELETE } = await import(
        "@/app/api/callers/[callerId]/actions/[actionId]/route"
      );

      const request = makeRequest(
        "http://localhost:3000/api/callers/caller-1/actions/act-1",
        { method: "DELETE" }
      );
      const response = await DELETE(request as any, {
        params: Promise.resolve({ callerId: "caller-1", actionId: "act-1" }),
      });

      expect(response.status).toBe(404);
    });
  });
});
