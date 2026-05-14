/**
 * Tests for /api/goals endpoint
 *
 * GET: List goals with filtering by status, type, and callerId.
 *      Returns aggregate counts grouped by status and type.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  goal: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

// =====================================================
// TESTS
// =====================================================

describe("/api/goals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("GET", () => {
    it("should return all goals with counts", async () => {
      const mockGoals = [
        {
          id: "goal-1",
          callerId: "caller-1",
          type: "LEARN",
          name: "Learn QM Basics",
          status: "ACTIVE",
          priority: 8,
          createdAt: new Date("2026-01-10"),
          caller: {
            id: "caller-1",
            name: "Alice",
            domain: { id: "d1", slug: "qm-tutor", name: "QM Tutor" },
          },
          playbook: { id: "pb-1", name: "QM Playbook", version: 1 },
          contentSpec: { id: "cs-1", slug: "wnf-content-001", name: "WNF Content" },
        },
        {
          id: "goal-2",
          callerId: "caller-1",
          type: "PRACTICE",
          name: "Practice Problems",
          status: "PAUSED",
          priority: 5,
          createdAt: new Date("2026-01-12"),
          caller: {
            id: "caller-1",
            name: "Alice",
            domain: { id: "d1", slug: "qm-tutor", name: "QM Tutor" },
          },
          playbook: null,
          contentSpec: null,
        },
      ];

      mockPrisma.goal.findMany.mockResolvedValue(mockGoals);
      mockPrisma.goal.groupBy
        .mockResolvedValueOnce([
          { status: "ACTIVE", _count: 1 },
          { status: "PAUSED", _count: 1 },
        ])
        .mockResolvedValueOnce([
          { type: "LEARN", _count: 1 },
          { type: "PRACTICE", _count: 1 },
        ]);

      const { GET } = await import("../../app/api/goals/route");
      const request = new Request("http://localhost/api/goals");
      const response = await GET(request as any);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.goals).toHaveLength(2);
      expect(data.counts.total).toBe(2);
      expect(data.counts.byStatus).toBeDefined();
      expect(data.counts.byType).toBeDefined();
    });

    it("should filter by status", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([]);
      mockPrisma.goal.groupBy.mockResolvedValue([]);

      const { GET } = await import("../../app/api/goals/route");
      const request = new Request("http://localhost/api/goals?status=ACTIVE");
      const response = await GET(request as any);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(mockPrisma.goal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "ACTIVE",
          }),
        })
      );
    });

    it("should filter by type", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([]);
      mockPrisma.goal.groupBy.mockResolvedValue([]);

      const { GET } = await import("../../app/api/goals/route");
      const request = new Request("http://localhost/api/goals?type=LEARN");
      const response = await GET(request as any);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(mockPrisma.goal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: "LEARN",
          }),
        })
      );
    });

    it("should filter by callerId", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([]);
      mockPrisma.goal.groupBy.mockResolvedValue([]);

      const { GET } = await import("../../app/api/goals/route");
      const request = new Request("http://localhost/api/goals?callerId=caller-1");
      const response = await GET(request as any);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(mockPrisma.goal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            callerId: "caller-1",
          }),
        })
      );
    });

    it("should not filter when status=all", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([]);
      mockPrisma.goal.groupBy.mockResolvedValue([]);

      const { GET } = await import("../../app/api/goals/route");
      const request = new Request("http://localhost/api/goals?status=all");
      const response = await GET(request as any);
      const data = await response.json();

      expect(data.ok).toBe(true);
      // When status=all, the where clause should not include status
      const whereArg = mockPrisma.goal.findMany.mock.calls[0][0].where;
      expect(whereArg.status).toBeUndefined();
    });

    it("should not filter when type=all", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([]);
      mockPrisma.goal.groupBy.mockResolvedValue([]);

      const { GET } = await import("../../app/api/goals/route");
      const request = new Request("http://localhost/api/goals?type=all");
      const response = await GET(request as any);
      const data = await response.json();

      expect(data.ok).toBe(true);
      const whereArg = mockPrisma.goal.findMany.mock.calls[0][0].where;
      expect(whereArg.type).toBeUndefined();
    });

    it("should include related caller, playbook, and contentSpec data", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([]);
      mockPrisma.goal.groupBy.mockResolvedValue([]);

      const { GET } = await import("../../app/api/goals/route");
      const request = new Request("http://localhost/api/goals");
      const response = await GET(request as any);
      await response.json();

      expect(mockPrisma.goal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            caller: expect.any(Object),
            playbook: expect.any(Object),
            contentSpec: expect.any(Object),
          }),
        })
      );
    });

    it("should return empty results when no goals exist", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([]);
      mockPrisma.goal.groupBy.mockResolvedValue([]);

      const { GET } = await import("../../app/api/goals/route");
      const request = new Request("http://localhost/api/goals");
      const response = await GET(request as any);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.goals).toHaveLength(0);
      expect(data.counts.total).toBe(0);
    });

    it("should return 500 on database error", async () => {
      mockPrisma.goal.findMany.mockRejectedValue(new Error("DB error"));

      const { GET } = await import("../../app/api/goals/route");
      const request = new Request("http://localhost/api/goals");
      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("DB error");
    });

    it("should combine multiple filters", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([]);
      mockPrisma.goal.groupBy.mockResolvedValue([]);

      const { GET } = await import("../../app/api/goals/route");
      const request = new Request("http://localhost/api/goals?status=ACTIVE&type=LEARN&callerId=caller-1");
      const response = await GET(request as any);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(mockPrisma.goal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: "ACTIVE",
            type: "LEARN",
            callerId: "caller-1",
          },
        })
      );
    });
  });
});
