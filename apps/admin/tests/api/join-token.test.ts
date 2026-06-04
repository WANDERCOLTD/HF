/**
 * Tests for /api/join/[token] endpoint
 *
 * GET: Verify a classroom join token and return classroom info
 * POST: Accept a join link — create User + Caller + set session
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  cohortGroup: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  caller: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  callerCohortMembership: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("next-auth/jwt", () => ({
  encode: vi.fn().mockResolvedValue("mock-jwt-token"),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  getClientIP: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/enrollment", () => ({
  enrollCallerInCohortPlaybooks: vi.fn().mockResolvedValue(undefined),
}));

// =====================================================
// TESTS
// =====================================================

describe("/api/join/[token]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Ensure NEXTAUTH_SECRET is set for POST tests
    process.env.NEXTAUTH_SECRET = "test-secret";
  });

  // ===================================================
  // GET — Verify join token
  // ===================================================
  describe("GET", () => {
    it("should return classroom info for valid token", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue({
        id: "cohort-1",
        name: "Year 10 Maths",
        isActive: true,
        joinToken: "validtoken1",
        domain: { name: "GCSE Maths" },
        owner: { name: "Ms Smith" },
        _count: { members: 15 },
      });

      const { GET } = await import("../../app/api/join/[token]/route");
      const request = new Request("http://localhost/api/join/validtoken1");
      const response = await GET(request as any, {
        params: Promise.resolve({ token: "validtoken1" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.classroom.name).toBe("Year 10 Maths");
      expect(data.classroom.domain).toBe("GCSE Maths");
      expect(data.classroom.teacher).toBe("Ms Smith");
      expect(data.classroom.memberCount).toBe(15);
    });

    it("should return 404 for invalid token", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue(null);

      const { GET } = await import("../../app/api/join/[token]/route");
      const request = new Request("http://localhost/api/join/badtoken");
      const response = await GET(request as any, {
        params: Promise.resolve({ token: "badtoken" }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Invalid or expired join link");
    });

    it("should return 404 for inactive cohort", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue({
        id: "cohort-1",
        name: "Inactive Class",
        isActive: false,
        joinToken: "sometoken",
        domain: { name: "Maths" },
        owner: { name: "Teacher" },
        _count: { members: 0 },
      });

      const { GET } = await import("../../app/api/join/[token]/route");
      const request = new Request("http://localhost/api/join/sometoken");
      const response = await GET(request as any, {
        params: Promise.resolve({ token: "sometoken" }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Invalid or expired join link");
    });

    it("should return 410 for expired join token", async () => {
      const pastDate = new Date("2025-01-01");
      mockPrisma.cohortGroup.findUnique.mockResolvedValue({
        id: "cohort-1",
        name: "Expired Class",
        isActive: true,
        joinToken: "expiredtok",
        joinTokenExp: pastDate,
        domain: { name: "Maths" },
        owner: { name: "Teacher" },
        _count: { members: 0 },
      });

      const { GET } = await import("../../app/api/join/[token]/route");
      const request = new Request("http://localhost/api/join/expiredtok");
      const response = await GET(request as any, {
        params: Promise.resolve({ token: "expiredtok" }),
      });
      const data = await response.json();

      expect(response.status).toBe(410);
      expect(data.error).toBe("This join link has expired");
    });

    it("should use fallback teacher name when owner name is null", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue({
        id: "cohort-1",
        name: "Test Class",
        isActive: true,
        joinToken: "tok123",
        domain: { name: "Science" },
        owner: { name: null },
        _count: { members: 3 },
      });

      const { GET } = await import("../../app/api/join/[token]/route");
      const request = new Request("http://localhost/api/join/tok123");
      const response = await GET(request as any, {
        params: Promise.resolve({ token: "tok123" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.classroom.teacher).toBe("Your teacher");
    });
  });

  // ===================================================
  // POST — Accept join link
  // ===================================================
  describe("POST", () => {
    it("should create new user and caller for valid token", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue({
        id: "cohort-1",
        name: "Year 10",
        isActive: true,
        joinToken: "validtok",
        domainId: "domain-1",
        domain: { id: "domain-1" },
      });
      mockPrisma.user.findUnique.mockResolvedValue(null); // no existing user

      const mockNewUser = {
        id: "new-user-1",
        email: "alice@school.com",
        name: "Alice Smith",
        role: "TESTER",
      };
      mockPrisma.$transaction.mockResolvedValue(mockNewUser);

      const { POST } = await import("../../app/api/join/[token]/route");
      const request = new Request("http://localhost/api/join/validtok", {
        method: "POST",
        body: JSON.stringify({
          firstName: "Alice",
          lastName: "Smith",
          email: "alice@school.com",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request as any, {
        params: Promise.resolve({ token: "validtok" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.message).toContain("joined");
      expect(data.redirect).toBe("/x/student/progress");
    });

    it("should add existing user to cohort without creating new user", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue({
        id: "cohort-1",
        name: "Year 10",
        isActive: true,
        joinToken: "validtok",
        domainId: "domain-1",
        domain: { id: "domain-1" },
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "existing-user",
        email: "bob@school.com",
        name: "Bob Jones",
      });
      mockPrisma.caller.findFirst.mockResolvedValue(null); // not already in this cohort
      mockPrisma.caller.create.mockResolvedValue({
        id: "new-caller",
        name: "Bob Jones",
      });

      const { POST } = await import("../../app/api/join/[token]/route");
      const request = new Request("http://localhost/api/join/validtok", {
        method: "POST",
        body: JSON.stringify({
          firstName: "Bob",
          lastName: "Jones",
          email: "bob@school.com",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request as any, {
        params: Promise.resolve({ token: "validtok" }),
      });
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.message).toBe("Joined classroom");
      expect(data.redirect).toBe("/x/student/progress");
      // Transaction should NOT have been called — existing user path
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("should return 400 if user is already a member", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue({
        id: "cohort-1",
        name: "Year 10",
        isActive: true,
        joinToken: "validtok",
        domainId: "domain-1",
        domain: { id: "domain-1" },
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "existing-user",
        email: "alice@school.com",
      });
      mockPrisma.caller.findFirst.mockResolvedValue({
        id: "existing-caller",
        userId: "existing-user",
        cohortGroupId: "cohort-1",
      });

      const { POST } = await import("../../app/api/join/[token]/route");
      const request = new Request("http://localhost/api/join/validtok", {
        method: "POST",
        body: JSON.stringify({
          firstName: "Alice",
          lastName: "Smith",
          email: "alice@school.com",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request as any, {
        params: Promise.resolve({ token: "validtok" }),
      });
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.error).toContain("already exists");
    });

    it("should return 400 if first name is missing", async () => {
      const { POST } = await import("../../app/api/join/[token]/route");
      const request = new Request("http://localhost/api/join/validtok", {
        method: "POST",
        body: JSON.stringify({
          lastName: "Smith",
          email: "alice@school.com",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request as any, {
        params: Promise.resolve({ token: "validtok" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request");
    });

    it("should return 400 if email is missing", async () => {
      const { POST } = await import("../../app/api/join/[token]/route");
      const request = new Request("http://localhost/api/join/validtok", {
        method: "POST",
        body: JSON.stringify({
          firstName: "Alice",
          lastName: "Smith",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request as any, {
        params: Promise.resolve({ token: "validtok" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request");
    });

    it("should return 400 for invalid email format", async () => {
      const { POST } = await import("../../app/api/join/[token]/route");
      const request = new Request("http://localhost/api/join/validtok", {
        method: "POST",
        body: JSON.stringify({
          firstName: "Alice",
          lastName: "Smith",
          email: "notanemail",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request as any, {
        params: Promise.resolve({ token: "validtok" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request");
    });

    it("should return 404 for invalid token", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue(null);

      const { POST } = await import("../../app/api/join/[token]/route");
      const request = new Request("http://localhost/api/join/badtoken", {
        method: "POST",
        body: JSON.stringify({
          firstName: "Alice",
          lastName: "Smith",
          email: "alice@school.com",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request as any, {
        params: Promise.resolve({ token: "badtoken" }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Invalid or expired join link");
    });

    it("should return 404 for inactive cohort", async () => {
      mockPrisma.cohortGroup.findUnique.mockResolvedValue({
        id: "cohort-1",
        name: "Inactive",
        isActive: false,
        joinToken: "sometok",
        domainId: "domain-1",
        domain: { id: "domain-1" },
      });

      const { POST } = await import("../../app/api/join/[token]/route");
      const request = new Request("http://localhost/api/join/sometok", {
        method: "POST",
        body: JSON.stringify({
          firstName: "Alice",
          lastName: "Smith",
          email: "alice@school.com",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await POST(request as any, {
        params: Promise.resolve({ token: "sometok" }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Invalid or expired join link");
    });
  });
});
