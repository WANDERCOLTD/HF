/**
 * Tests for /api/callers endpoint
 *
 * GET: List callers with pagination, optional counts
 * POST: Create a new caller with auto-domain assignment
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  caller: {
    findMany: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
  callerMemory: {
    groupBy: vi.fn(),
  },
  call: {
    groupBy: vi.fn(),
  },
  domain: {
    findFirst: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx) => tx ?? mockPrisma,
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

vi.mock("@/lib/enrollment", () => ({
  enrollCaller: vi.fn().mockResolvedValue(undefined),
  enrollCallerInCohortPlaybooks: vi.fn().mockResolvedValue(undefined),
  enrollCallerInDomainPlaybooks: vi.fn().mockResolvedValue(undefined),
  resolveAndEnrollSingle: vi.fn().mockResolvedValue(null),
}));

// =====================================================
// TESTS
// =====================================================

describe("/api/callers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ===================================================
  // GET /api/callers
  // ===================================================
  describe("GET", () => {
    it("should return paginated callers with default limit/offset", async () => {
      const mockCallers = [
        {
          id: "caller-1",
          name: "Alice",
          email: "alice@example.com",
          phone: "+1111111111",
          externalId: "ext-1",
          domainId: "domain-1",
          domain: { id: "domain-1", slug: "test", name: "Test Domain" },
          personality: null,
          createdAt: new Date("2026-01-15"),
        },
        {
          id: "caller-2",
          name: "Bob",
          email: null,
          phone: null,
          externalId: "ext-2",
          domainId: null,
          domain: null,
          personality: { openness: 0.7, conscientiousness: 0.6, extraversion: 0.5, agreeableness: 0.8, neuroticism: 0.3, preferredTone: "casual", preferredLength: "short", technicalLevel: "beginner", confidenceScore: 0.75 },
          createdAt: new Date("2026-01-10"),
        },
      ];

      mockPrisma.caller.findMany.mockResolvedValue(mockCallers);
      mockPrisma.caller.count.mockResolvedValue(2);

      const { GET } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers");
      const response = await GET(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.callers).toHaveLength(2);
      expect(data.total).toBe(2);
      expect(data.limit).toBe(100);
      expect(data.offset).toBe(0);
      // Without withCounts, _count should be zeros
      expect(data.callers[0]._count).toEqual({ memories: 0, calls: 0 });
      expect(data.callers[1]._count).toEqual({ memories: 0, calls: 0 });
    });

    it("should respect custom limit and offset", async () => {
      mockPrisma.caller.findMany.mockResolvedValue([]);
      mockPrisma.caller.count.mockResolvedValue(0);

      const { GET } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers?limit=10&offset=20");
      const response = await GET(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.limit).toBe(10);
      expect(data.offset).toBe(20);
      expect(mockPrisma.caller.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 20 })
      );
    });

    it("should cap limit at 500", async () => {
      mockPrisma.caller.findMany.mockResolvedValue([]);
      mockPrisma.caller.count.mockResolvedValue(0);

      const { GET } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers?limit=9999");
      const response = await GET(request);
      const data = await response.json();

      expect(data.limit).toBe(500);
    });

    it("should fetch memory and call counts when withCounts=true", async () => {
      const mockCallers = [
        {
          id: "caller-1",
          name: "Alice",
          email: null,
          phone: null,
          externalId: "ext-1",
          domainId: null,
          domain: null,
          personality: null,
          createdAt: new Date("2026-01-15"),
        },
      ];

      mockPrisma.caller.findMany.mockResolvedValue(mockCallers);
      mockPrisma.caller.count.mockResolvedValue(1);
      mockPrisma.callerMemory.groupBy.mockResolvedValue([
        { callerId: "caller-1", _count: { id: 5 } },
      ]);
      mockPrisma.call.groupBy.mockResolvedValue([
        { callerId: "caller-1", _count: { id: 3 } },
      ]);

      const { GET } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers?withCounts=true");
      const response = await GET(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.callers[0]._count).toEqual({ memories: 5, calls: 3 });
    });

    it("should flatten caller data correctly", async () => {
      const mockCallers = [
        {
          id: "caller-1",
          name: "Alice",
          email: "alice@example.com",
          phone: "+111",
          externalId: "ext-1",
          domainId: "domain-1",
          domain: { id: "domain-1", slug: "test", name: "Test" },
          personality: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, preferredTone: null, preferredLength: null, technicalLevel: null, confidenceScore: 0.5 },
          createdAt: new Date("2026-01-01"),
        },
      ];

      mockPrisma.caller.findMany.mockResolvedValue(mockCallers);
      mockPrisma.caller.count.mockResolvedValue(1);

      const { GET } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers");
      const response = await GET(request);
      const data = await response.json();

      const caller = data.callers[0];
      expect(caller.id).toBe("caller-1");
      expect(caller.name).toBe("Alice");
      expect(caller.email).toBe("alice@example.com");
      expect(caller.phone).toBe("+111");
      expect(caller.externalId).toBe("ext-1");
      expect(caller.domainId).toBe("domain-1");
      expect(caller.domain).toEqual({ id: "domain-1", slug: "test", name: "Test" });
      expect(caller.personality).toBeDefined();
    });

    it("should return 500 on database error", async () => {
      mockPrisma.caller.findMany.mockRejectedValue(new Error("DB connection lost"));

      const { GET } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("DB connection lost");
    });
  });

  // ===================================================
  // POST /api/callers
  // ===================================================
  describe("POST", () => {
    it("should create a caller with provided name", async () => {
      const createdCaller = {
        id: "new-caller-1",
        name: "Charlie",
        email: null,
        phone: null,
        externalId: "playground-123",
        domainId: null,
        domain: null,
      };

      mockPrisma.domain.findFirst.mockResolvedValue({ id: "d-1", slug: "default", name: "Default", isDefault: true });
      mockPrisma.caller.create.mockResolvedValue(createdCaller);

      const { POST } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers", {
        method: "POST",
        body: JSON.stringify({ name: "Charlie" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.caller.id).toBe("new-caller-1");
      expect(data.caller.name).toBe("Charlie");
    });

    it("should auto-assign default domain when no domainId provided", async () => {
      const defaultDomain = { id: "domain-default", slug: "default", name: "Default Domain" };
      mockPrisma.domain.findFirst.mockResolvedValue(defaultDomain);
      mockPrisma.caller.create.mockResolvedValue({
        id: "new-caller-2",
        name: "Dana",
        email: null,
        phone: null,
        domainId: "domain-default",
        domain: defaultDomain,
      });

      const { POST } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers", {
        method: "POST",
        body: JSON.stringify({ name: "Dana" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.caller.domain).toEqual(defaultDomain);
      // Verify domain.findFirst was called with isDefault: true
      expect(mockPrisma.domain.findFirst).toHaveBeenCalledWith({
        where: { isDefault: true },
      });
    });

    it("should create caller with email and phone", async () => {
      mockPrisma.domain.findFirst.mockResolvedValue({ id: "d-1", slug: "default", name: "Default", isDefault: true });
      mockPrisma.caller.create.mockResolvedValue({
        id: "new-caller-3",
        name: "Eve",
        email: "eve@example.com",
        phone: "+999",
        domain: { id: "d-1", slug: "default", name: "Default" },
      });

      const { POST } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers", {
        method: "POST",
        body: JSON.stringify({ name: "Eve", email: "eve@example.com", phone: "+999" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.caller.email).toBe("eve@example.com");
      expect(data.caller.phone).toBe("+999");
    });

    it("should return 400 when name is missing", async () => {
      const { POST } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("Name is required");
    });

    it("should return 400 when name is empty string", async () => {
      const { POST } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers", {
        method: "POST",
        body: JSON.stringify({ name: "" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("Name is required");
    });

    it("should return 500 on database error during creation", async () => {
      mockPrisma.domain.findFirst.mockResolvedValue({ id: "d-1", slug: "default", name: "Default", isDefault: true });
      mockPrisma.caller.create.mockRejectedValue(new Error("Unique constraint failed"));

      const { POST } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers", {
        method: "POST",
        body: JSON.stringify({ name: "Fail" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.ok).toBe(false);
      expect(data.error).toBe("Unique constraint failed");
    });

    it("should enroll in specific playbook when playbookId is provided", async () => {
      const { enrollCaller } = await import("@/lib/enrollment");

      mockPrisma.caller.create.mockResolvedValue({
        id: "new-caller-pb",
        name: "Grace",
        email: null,
        phone: null,
        domainId: "domain-1",
        domain: { id: "domain-1", slug: "test", name: "Test" },
      });

      const { POST } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers", {
        method: "POST",
        body: JSON.stringify({ name: "Grace", domainId: "domain-1", playbookId: "pb-123" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(enrollCaller).toHaveBeenCalledWith("new-caller-pb", "pb-123", "auto");
    });

    it("should use smart single-playbook enrollment when no playbookId", async () => {
      const { resolveAndEnrollSingle } = await import("@/lib/enrollment");

      mockPrisma.domain.findFirst.mockResolvedValue({ id: "d-1", slug: "default", name: "Default", isDefault: true });
      mockPrisma.caller.create.mockResolvedValue({
        id: "new-caller-fb",
        name: "Hank",
        email: null,
        phone: null,
        domainId: "d-1",
        domain: { id: "d-1", slug: "default", name: "Default" },
      });

      const { POST } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers", {
        method: "POST",
        body: JSON.stringify({ name: "Hank" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(resolveAndEnrollSingle).toHaveBeenCalledWith("new-caller-fb", "d-1", "auto");
    });

    it("should use provided domainId and skip default domain lookup", async () => {
      mockPrisma.caller.create.mockResolvedValue({
        id: "new-caller-4",
        name: "Frank",
        email: null,
        phone: null,
        domainId: "explicit-domain",
        domain: { id: "explicit-domain", slug: "explicit", name: "Explicit" },
      });

      const { POST } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers", {
        method: "POST",
        body: JSON.stringify({ name: "Frank", domainId: "explicit-domain" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      // domain.findFirst should NOT be called when domainId is provided
      expect(mockPrisma.domain.findFirst).not.toHaveBeenCalled();
    });
  });

  // ===================================================
  // Archive functionality
  // ===================================================
  describe("Archive filtering", () => {
    it("should exclude archived callers by default", async () => {
      const mockCallers = [
        {
          id: "caller-active",
          name: "Active Caller",
          email: null,
          phone: null,
          externalId: "ext-active",
          domainId: null,
          domain: null,
          personality: null,
          createdAt: new Date("2026-01-15"),
          archivedAt: null,
        },
      ];

      mockPrisma.caller.findMany.mockResolvedValue(mockCallers);
      mockPrisma.caller.count.mockResolvedValue(1);

      const { GET } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers");
      const response = await GET(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      // Verify the where clause includes archivedAt: null filter
      expect(mockPrisma.caller.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ archivedAt: null }),
        })
      );
    });

    it("should include archived callers when includeArchived=true", async () => {
      const mockCallers = [
        {
          id: "caller-active",
          name: "Active",
          email: null,
          phone: null,
          externalId: "ext-1",
          domainId: null,
          domain: null,
          personality: null,
          createdAt: new Date("2026-01-15"),
          archivedAt: null,
        },
        {
          id: "caller-archived",
          name: "Archived",
          email: null,
          phone: null,
          externalId: "ext-2",
          domainId: null,
          domain: null,
          personality: null,
          createdAt: new Date("2026-01-10"),
          archivedAt: new Date("2026-02-01"),
        },
      ];

      mockPrisma.caller.findMany.mockResolvedValue(mockCallers);
      mockPrisma.caller.count.mockResolvedValue(2);

      const { GET } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers?includeArchived=true");
      const response = await GET(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.callers).toHaveLength(2);
      // Verify the where clause does NOT include archivedAt filter
      expect(mockPrisma.caller.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ archivedAt: null }),
        })
      );
    });

    it("should include archivedAt in response", async () => {
      const archivedDate = new Date("2026-02-01");
      const mockCallers = [
        {
          id: "caller-1",
          name: "Archived Caller",
          email: null,
          phone: null,
          externalId: "ext-1",
          domainId: null,
          domain: null,
          personality: null,
          createdAt: new Date("2026-01-15"),
          archivedAt: archivedDate,
        },
      ];

      mockPrisma.caller.findMany.mockResolvedValue(mockCallers);
      mockPrisma.caller.count.mockResolvedValue(1);

      const { GET } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers?includeArchived=true");
      const response = await GET(request);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.callers[0].archivedAt).toBe(archivedDate.toISOString());
    });

    it("should use same where clause for count and findMany", async () => {
      mockPrisma.caller.findMany.mockResolvedValue([]);
      mockPrisma.caller.count.mockResolvedValue(0);

      const { GET } = await import("../../app/api/callers/route");
      const request = new Request("http://localhost/api/callers");
      await GET(request);

      // Both should filter by archivedAt: null
      const findManyWhere = mockPrisma.caller.findMany.mock.calls[0][0].where;
      const countWhere = mockPrisma.caller.count.mock.calls[0][0].where;
      expect(findManyWhere).toEqual(countWhere);
    });
  });
});
