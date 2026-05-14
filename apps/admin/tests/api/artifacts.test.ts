/**
 * Tests for /api/callers/:callerId/artifacts endpoint
 *
 * GET: List artifacts for a caller with optional filters.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  caller: {
    findUnique: vi.fn(),
  },
  conversationArtifact: {
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

// =====================================================
// HELPERS
// =====================================================

function makeRequest(url: string) {
  return new Request(url, { method: "GET" });
}

// =====================================================
// TESTS
// =====================================================

describe("/api/callers/:callerId/artifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("GET", () => {
    it("should return artifacts for a caller", async () => {
      const mockArtifacts = [
        {
          id: "art-1",
          callId: "call-1",
          callerId: "caller-1",
          type: "KEY_FACT",
          title: "ISA Allowance",
          content: "The ISA allowance is £20,000.",
          trustLevel: "VERIFIED",
          confidence: 0.95,
          status: "DELIVERED",
          channel: "sim",
          createdAt: new Date("2026-02-14"),
        },
        {
          id: "art-2",
          callId: "call-1",
          callerId: "caller-1",
          type: "EXERCISE",
          title: "Practice Question",
          content: "How much ISA allowance remains after £12k used?",
          trustLevel: "INFERRED",
          confidence: 0.9,
          status: "DELIVERED",
          channel: "sim",
          createdAt: new Date("2026-02-14"),
        },
      ];

      mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1" });
      mockPrisma.conversationArtifact.findMany.mockResolvedValue(mockArtifacts);

      const { GET } = await import(
        "@/app/api/callers/[callerId]/artifacts/route"
      );

      const request = makeRequest(
        "http://localhost:3000/api/callers/caller-1/artifacts"
      );
      const response = await GET(request as any, {
        params: Promise.resolve({ callerId: "caller-1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.artifacts).toHaveLength(2);
      expect(data.artifacts[0].type).toBe("KEY_FACT");
      expect(data.artifacts[1].type).toBe("EXERCISE");
    });

    it("should filter by callId", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1" });
      mockPrisma.conversationArtifact.findMany.mockResolvedValue([]);

      const { GET } = await import(
        "@/app/api/callers/[callerId]/artifacts/route"
      );

      const request = makeRequest(
        "http://localhost:3000/api/callers/caller-1/artifacts?callId=call-42"
      );
      await GET(request as any, {
        params: Promise.resolve({ callerId: "caller-1" }),
      });

      const findCall = mockPrisma.conversationArtifact.findMany.mock.calls[0][0];
      expect(findCall.where.callId).toBe("call-42");
    });

    it("should filter by status", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1" });
      mockPrisma.conversationArtifact.findMany.mockResolvedValue([]);

      const { GET } = await import(
        "@/app/api/callers/[callerId]/artifacts/route"
      );

      const request = makeRequest(
        "http://localhost:3000/api/callers/caller-1/artifacts?status=PENDING"
      );
      await GET(request as any, {
        params: Promise.resolve({ callerId: "caller-1" }),
      });

      const findCall = mockPrisma.conversationArtifact.findMany.mock.calls[0][0];
      expect(findCall.where.status).toBe("PENDING");
    });

    it("should return 404 for non-existent caller", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue(null);

      const { GET } = await import(
        "@/app/api/callers/[callerId]/artifacts/route"
      );

      const request = makeRequest(
        "http://localhost:3000/api/callers/nonexistent/artifacts"
      );
      const response = await GET(request as any, {
        params: Promise.resolve({ callerId: "nonexistent" }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("Caller not found");
    });
  });
});
