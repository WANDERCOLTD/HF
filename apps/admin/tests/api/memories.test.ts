/**
 * Tests for /api/memories endpoint
 *
 * GET: List caller memories with filtering, search, and pagination
 * POST: Create a new memory with deduplication (supersede or update confidence)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  callerMemory: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  caller: {
    findUnique: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

// =====================================================
// TESTS
// =====================================================

describe("/api/memories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ===================================================
  // GET /api/memories
  // ===================================================
  describe("GET", () => {
    it("should return paginated memories with defaults", async () => {
      const mockMemories = [
        {
          id: "mem-1",
          category: "FACT",
          key: "location",
          value: "London",
          evidence: "Mentioned in call",
          confidence: 0.9,
          extractedAt: new Date("2026-01-20"),
          expiresAt: null,
          caller: { id: "caller-1", name: "Alice", email: null, externalId: "ext-1" },
          call: { id: "call-1", source: "sim", createdAt: new Date() },
          supersededBy: null,
        },
      ];

      mockPrisma.callerMemory.findMany.mockResolvedValue(mockMemories);
      mockPrisma.callerMemory.count.mockResolvedValue(1);

      const { GET } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories");
      const response = await GET(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.memories).toHaveLength(1);
      expect(data.total).toBe(1);
      expect(data.limit).toBe(100);
      expect(data.offset).toBe(0);
    });

    it("should filter by callerId", async () => {
      mockPrisma.callerMemory.findMany.mockResolvedValue([]);
      mockPrisma.callerMemory.count.mockResolvedValue(0);

      const { GET } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories?callerId=caller-1");
      const response = await GET(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(mockPrisma.callerMemory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            callerId: "caller-1",
          }),
        })
      );
    });

    it("should filter by category", async () => {
      mockPrisma.callerMemory.findMany.mockResolvedValue([]);
      mockPrisma.callerMemory.count.mockResolvedValue(0);

      const { GET } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories?category=FACT");
      const response = await GET(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(mockPrisma.callerMemory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: "FACT",
          }),
        })
      );
    });

    it("should respect custom limit and offset", async () => {
      mockPrisma.callerMemory.findMany.mockResolvedValue([]);
      mockPrisma.callerMemory.count.mockResolvedValue(0);

      const { GET } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories?limit=25&offset=50");
      const response = await GET(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.limit).toBe(25);
      expect(data.offset).toBe(50);
      expect(mockPrisma.callerMemory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 25, skip: 50 })
      );
    });

    it("should cap limit at 500", async () => {
      mockPrisma.callerMemory.findMany.mockResolvedValue([]);
      mockPrisma.callerMemory.count.mockResolvedValue(0);

      const { GET } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories?limit=9999");
      const response = await GET(request);
      const data = await response.json();

      expect(data.limit).toBe(500);
    });

    it("should exclude superseded memories by default", async () => {
      mockPrisma.callerMemory.findMany.mockResolvedValue([]);
      mockPrisma.callerMemory.count.mockResolvedValue(0);

      const { GET } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories");
      const response = await GET(request);
      await response.json();

      expect(mockPrisma.callerMemory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            supersededById: null,
          }),
        })
      );
    });

    it("should return 500 on database error", async () => {
      mockPrisma.callerMemory.findMany.mockRejectedValue(new Error("DB connection lost"));

      const { GET } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("DB connection lost");
    });
  });

  // ===================================================
  // POST /api/memories
  // ===================================================
  describe("POST", () => {
    it("should create a new memory for a caller", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1", name: "Alice" });
      mockPrisma.callerMemory.findFirst.mockResolvedValue(null); // no existing memory
      mockPrisma.callerMemory.create.mockResolvedValue({
        id: "mem-new",
        callerId: "caller-1",
        category: "FACT",
        key: "favorite_color",
        value: "blue",
        confidence: 0.95,
        source: "STATED",
        normalizedKey: "favorite_color",
        extractedBy: "manual",
      });

      const { POST } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({
          callerId: "caller-1",
          category: "FACT",
          key: "favorite_color",
          value: "blue",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.memory.id).toBe("mem-new");
      expect(data.supersededId).toBeNull();
    });

    it("should supersede existing memory with different value", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1", name: "Alice" });
      mockPrisma.callerMemory.findFirst.mockResolvedValue({
        id: "mem-old",
        callerId: "caller-1",
        normalizedKey: "favorite_color",
        value: "red",
        confidence: 0.8,
      });
      mockPrisma.callerMemory.create.mockResolvedValue({
        id: "mem-new",
        callerId: "caller-1",
        category: "FACT",
        key: "favorite_color",
        value: "blue",
        confidence: 0.95,
        source: "CORRECTED",
      });
      mockPrisma.callerMemory.update.mockResolvedValue({});

      const { POST } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({
          callerId: "caller-1",
          category: "FACT",
          key: "favorite_color",
          value: "blue",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.supersededId).toBe("mem-old");
      // Old memory should have been updated with supersededById
      expect(mockPrisma.callerMemory.update).toHaveBeenCalledWith({
        where: { id: "mem-old" },
        data: { supersededById: "mem-new" },
      });
    });

    it("should update confidence when same key and value exist", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1", name: "Alice" });
      mockPrisma.callerMemory.findFirst.mockResolvedValue({
        id: "mem-existing",
        callerId: "caller-1",
        normalizedKey: "favorite_color",
        value: "blue",
        confidence: 0.7,
      });
      mockPrisma.callerMemory.update.mockResolvedValue({
        id: "mem-existing",
        confidence: 0.95,
        verifiedAt: new Date(),
        verifiedBy: "manual",
      });

      const { POST } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({
          callerId: "caller-1",
          category: "FACT",
          key: "favorite_color",
          value: "blue",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.supersededId).toBeNull();
      // Should update the existing memory's confidence
      expect(mockPrisma.callerMemory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mem-existing" },
          data: expect.objectContaining({
            confidence: 0.95,
            verifiedBy: "manual",
          }),
        })
      );
    });

    it("should return 400 when callerId is missing", async () => {
      const { POST } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({ category: "FACT", key: "k", value: "v" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("callerId is required");
    });

    it("should return 400 when category is invalid", async () => {
      const { POST } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({ callerId: "c1", category: "INVALID", key: "k", value: "v" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Valid category is required");
    });

    it("should return 400 when category is missing", async () => {
      const { POST } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({ callerId: "c1", key: "k", value: "v" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Valid category is required");
    });

    it("should return 400 when key or value is missing", async () => {
      const { POST } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({ callerId: "c1", category: "FACT", key: "k" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("key and value are required");
    });

    it("should return 404 when caller does not exist", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue(null);

      const { POST } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({
          callerId: "nonexistent",
          category: "FACT",
          key: "k",
          value: "v",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("Caller not found");
    });

    it("should return 500 on database error during creation", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1" });
      mockPrisma.callerMemory.findFirst.mockRejectedValue(new Error("DB error"));

      const { POST } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({
          callerId: "caller-1",
          category: "FACT",
          key: "k",
          value: "v",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.ok).toBe(false);
    });

    it("should handle custom confidence and expiresInDays", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1" });
      mockPrisma.callerMemory.findFirst.mockResolvedValue(null);
      mockPrisma.callerMemory.create.mockResolvedValue({
        id: "mem-exp",
        confidence: 0.7,
        expiresAt: new Date("2026-02-15"),
      });

      const { POST } = await import("../../app/api/memories/route");
      const request = new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({
          callerId: "caller-1",
          category: "EVENT",
          key: "meeting",
          value: "Had a meeting",
          confidence: 0.7,
          expiresInDays: 30,
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      // Verify create was called with correct confidence and expiresAt
      expect(mockPrisma.callerMemory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            confidence: 0.7,
            expiresAt: expect.any(Date),
          }),
        })
      );
    });
  });
});
