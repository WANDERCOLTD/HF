/**
 * Tests for /api/communities and /api/communities/[communityId] endpoints
 *
 * GET /api/communities: List all communities (Domains with kind=COMMUNITY)
 * GET /api/communities/[communityId]: Get a single community detail with identity specs + onboarding config
 * PATCH /api/communities/[communityId]: Update community — name, description, welcome, identity spec, flow phases, targets
 * DELETE /api/communities/[communityId]: Archive a community (soft delete)
 * POST /api/communities/[communityId]/members: Add a caller to a community
 * DELETE /api/communities/[communityId]/members/[callerId]: Remove a caller from a community
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// =====================================================
// MOCK SETUP
// =====================================================

const { mockPrisma, mockRequireAuth } = vi.hoisted(() => ({
  mockPrisma: {
    domain: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    analysisSpec: {
      findMany: vi.fn(),
    },
    caller: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockRequireAuth: vi.fn().mockResolvedValue({
    session: {
      user: { id: "test-user", email: "test@example.com", name: "Test User", role: "OPERATOR" },
    },
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mockRequireAuth(...args),
  isAuthError: vi.fn().mockReturnValue(false),
}));

import { GET as getCommunitiesList } from "@/app/api/communities/route";
import { GET as getCommunity, PATCH as patchCommunity, DELETE as deleteCommunity } from "@/app/api/communities/[communityId]/route";
import { POST as addMember } from "@/app/api/communities/[communityId]/members/route";
import { DELETE as removeMember } from "@/app/api/communities/[communityId]/members/[callerId]/route";

const mockCommunity = {
  id: "comm-1",
  slug: "language-partners",
  name: "Language Learning Partners",
  description: "A community for language learners",
  kind: "COMMUNITY",
  isActive: true,
  createdAt: new Date("2025-01-01"),
  onboardingWelcome: "Welcome to Language Learning Partners!",
  onboardingIdentitySpecId: "spec-123",
  onboardingFlowPhases: null,
  onboardingDefaultTargets: null,
  onboardingIdentitySpec: {
    id: "spec-123",
    slug: "COMPANION-001",
    name: "Companion",
    config: { personaName: "Language Coach" },
  },
  _count: {
    callers: 5,
    playbooks: 1,
  },
  callers: [
    { id: "caller-1", name: "Alice", email: "alice@test.com", role: "LEARNER", createdAt: new Date("2025-01-05") },
    { id: "caller-2", name: "Bob", email: "bob@test.com", role: "LEARNER", createdAt: new Date("2025-01-06") },
  ],
};

const mockIdentitySpecs = [
  { id: "spec-123", slug: "COMPANION-001", name: "Companion" },
  { id: "spec-456", slug: "TUT-001", name: "Tutor" },
];

/** Helper for Next.js 16 params pattern */
const p = <T extends Record<string, string>>(obj: T) => ({ params: Promise.resolve(obj) });

// =====================================================
// TESTS
// =====================================================

describe("/api/communities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      session: {
        user: { id: "test-user", email: "test@example.com", name: "Test User", role: "OPERATOR" },
      },
    });
  });

  describe("GET /api/communities", () => {
    it("lists all communities", async () => {
      mockPrisma.domain.findMany.mockResolvedValue([mockCommunity]);

      const req = new NextRequest("http://localhost/api/communities");
      const res = await getCommunitiesList(req);
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(body.communities).toHaveLength(1);
      expect(body.communities[0].name).toBe("Language Learning Partners");
      expect(body.communities[0].memberCount).toBe(5);
    });

    it("filters by kind=COMMUNITY", async () => {
      await getCommunitiesList(new NextRequest("http://localhost/api/communities"));

      expect(mockPrisma.domain.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ kind: "COMMUNITY" }),
        })
      );
    });

    it("requires OPERATOR role", async () => {
      mockRequireAuth.mockResolvedValue({
        error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, statusText: "Forbidden" }),
      });
      const { isAuthError } = await import("@/lib/permissions") as any;
      isAuthError.mockReturnValueOnce(true);

      const res = await getCommunitiesList(new NextRequest("http://localhost/api/communities"));
      expect(res.status).toBe(403);
    });

    it("returns empty list when no communities exist", async () => {
      mockPrisma.domain.findMany.mockResolvedValue([]);

      const req = new NextRequest("http://localhost/api/communities");
      const res = await getCommunitiesList(req);
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(body.communities).toEqual([]);
      expect(body.count).toBe(0);
    });
  });

  describe("GET /api/communities/[communityId]", () => {
    it("returns community details with identity specs and members", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue(mockCommunity);
      mockPrisma.analysisSpec.findMany.mockResolvedValue(mockIdentitySpecs);

      const req = new NextRequest("http://localhost/api/communities/comm-1");
      const res = await getCommunity(req, p({ communityId: "comm-1" }));
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(body.community.name).toBe("Language Learning Partners");
      expect(body.community.memberCount).toBe(5);
      expect(body.community.members).toHaveLength(2);
      expect(body.community.identitySpecs).toHaveLength(2);
      expect(body.community.identitySpec).toEqual({
        id: "spec-123",
        slug: "COMPANION-001",
        name: "Companion",
      });
      expect(body.community.personaName).toBe("Language Coach");
      expect(body.community.onboardingWelcome).toBe("Welcome to Language Learning Partners!");
    });

    it("returns 404 if community not found", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue(null);

      const req = new NextRequest("http://localhost/api/communities/nonexistent");
      const res = await getCommunity(req, p({ communityId: "nonexistent" }));
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.ok).toBe(false);
      expect(body.error).toContain("not found");
    });

    it("returns 404 if domain kind is not COMMUNITY", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        ...mockCommunity,
        kind: "INSTITUTION",
      });

      const req = new NextRequest("http://localhost/api/communities/comm-1");
      const res = await getCommunity(req, p({ communityId: "comm-1" }));
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.ok).toBe(false);
    });
  });

  describe("PATCH /api/communities/[communityId]", () => {
    it("updates community name", async () => {
      const updated = { ...mockCommunity, name: "New Name" };
      mockPrisma.domain.findUnique.mockResolvedValue(mockCommunity);
      mockPrisma.domain.update.mockResolvedValue(updated);

      const req = new NextRequest("http://localhost/api/communities/comm-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });

      const res = await patchCommunity(req, p({ communityId: "comm-1" }));
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(mockPrisma.domain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "comm-1" },
          data: { name: "New Name" },
        })
      );
    });

    it("updates welcome message", async () => {
      const updated = { ...mockCommunity, onboardingWelcome: "New Welcome" };
      mockPrisma.domain.findUnique.mockResolvedValue(mockCommunity);
      mockPrisma.domain.update.mockResolvedValue(updated);

      const req = new NextRequest("http://localhost/api/communities/comm-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingWelcome: "New Welcome" }),
      });

      const res = await patchCommunity(req, p({ communityId: "comm-1" }));
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(mockPrisma.domain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { onboardingWelcome: "New Welcome" },
        })
      );
    });

    it("updates identity spec and default targets", async () => {
      const targets = { warmth: 0.7, formality: 0.3, _matrixPositions: { p1: { x: 0.7, y: 0.3 } } };
      const updated = {
        ...mockCommunity,
        onboardingIdentitySpecId: "spec-456",
        onboardingDefaultTargets: targets,
      };
      mockPrisma.domain.findUnique.mockResolvedValue(mockCommunity);
      mockPrisma.domain.update.mockResolvedValue(updated);

      const req = new NextRequest("http://localhost/api/communities/comm-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          onboardingIdentitySpecId: "spec-456",
          onboardingDefaultTargets: targets,
        }),
      });

      const res = await patchCommunity(req, p({ communityId: "comm-1" }));
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(mockPrisma.domain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            onboardingIdentitySpecId: "spec-456",
            onboardingDefaultTargets: targets,
          },
        })
      );
    });

    it("updates flow phases", async () => {
      const phases = [{ name: "Greeting", prompt: "Hello" }];
      const updated = { ...mockCommunity, onboardingFlowPhases: phases };
      mockPrisma.domain.findUnique.mockResolvedValue(mockCommunity);
      mockPrisma.domain.update.mockResolvedValue(updated);

      const req = new NextRequest("http://localhost/api/communities/comm-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingFlowPhases: phases }),
      });

      const res = await patchCommunity(req, p({ communityId: "comm-1" }));
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(mockPrisma.domain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { onboardingFlowPhases: phases },
        })
      );
    });

    it("returns 400 if no fields to update", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue(mockCommunity);

      const req = new NextRequest("http://localhost/api/communities/comm-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await patchCommunity(req, p({ communityId: "comm-1" }));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.ok).toBe(false);
    });

    it("returns 404 if community not found", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue(null);

      const req = new NextRequest("http://localhost/api/communities/nonexistent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });

      const res = await patchCommunity(req, p({ communityId: "nonexistent" }));
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.ok).toBe(false);
    });
  });

  describe("DELETE /api/communities/[communityId]", () => {
    it("archives a community", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue(mockCommunity);
      mockPrisma.domain.update.mockResolvedValue({
        ...mockCommunity,
        isActive: false,
      });

      const req = new NextRequest("http://localhost/api/communities/comm-1", {
        method: "DELETE",
      });

      const res = await deleteCommunity(req, p({ communityId: "comm-1" }));
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(mockPrisma.domain.update).toHaveBeenCalledWith({
        where: { id: "comm-1" },
        data: { isActive: false },
      });
    });

    it("returns 404 if community not found", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue(null);

      const req = new NextRequest("http://localhost/api/communities/nonexistent", {
        method: "DELETE",
      });

      const res = await deleteCommunity(req, p({ communityId: "nonexistent" }));
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.ok).toBe(false);
    });

    it("requires OPERATOR role", async () => {
      mockRequireAuth.mockResolvedValue({
        error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, statusText: "Forbidden" }),
      });
      const { isAuthError } = await import("@/lib/permissions") as any;
      isAuthError.mockReturnValueOnce(true);

      const res = await deleteCommunity(
        new NextRequest("http://localhost/api/communities/comm-1", { method: "DELETE" }),
        p({ communityId: "comm-1" })
      );

      expect(res.status).toBe(403);
    });
  });

  // =====================================================
  // MEMBER MANAGEMENT
  // =====================================================

  describe("POST /api/communities/[communityId]/members", () => {
    it("adds a caller to a community", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({ kind: "COMMUNITY" });
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-3",
        name: "Charlie",
        email: "charlie@test.com",
        domainId: null,
      });
      mockPrisma.caller.update.mockResolvedValue({
        id: "caller-3",
        name: "Charlie",
        email: "charlie@test.com",
      });

      const req = new NextRequest("http://localhost/api/communities/comm-1/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerId: "caller-3" }),
      });

      const res = await addMember(req, p({ communityId: "comm-1" }));
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(body.member.id).toBe("caller-3");
      expect(mockPrisma.caller.update).toHaveBeenCalledWith({
        where: { id: "caller-3" },
        data: { domainId: "comm-1" },
        select: { id: true, name: true, email: true },
      });
    });

    it("returns 400 if callerId missing", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({ kind: "COMMUNITY" });

      const req = new NextRequest("http://localhost/api/communities/comm-1/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await addMember(req, p({ communityId: "comm-1" }));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("callerId");
    });

    it("returns 404 if community not found", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue(null);

      const req = new NextRequest("http://localhost/api/communities/nonexistent/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerId: "caller-3" }),
      });

      const res = await addMember(req, p({ communityId: "nonexistent" }));
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toContain("Community not found");
    });

    it("returns 404 if caller not found", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({ kind: "COMMUNITY" });
      mockPrisma.caller.findUnique.mockResolvedValue(null);

      const req = new NextRequest("http://localhost/api/communities/comm-1/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerId: "nonexistent" }),
      });

      const res = await addMember(req, p({ communityId: "comm-1" }));
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toContain("Caller not found");
    });

    it("returns 409 if caller already a member", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({ kind: "COMMUNITY" });
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        name: "Alice",
        email: "alice@test.com",
        domainId: "comm-1",
      });

      const req = new NextRequest("http://localhost/api/communities/comm-1/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerId: "caller-1" }),
      });

      const res = await addMember(req, p({ communityId: "comm-1" }));
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toContain("already a member");
    });
  });

  describe("DELETE /api/communities/[communityId]/members/[callerId]", () => {
    it("removes a caller from a community", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({ kind: "COMMUNITY" });
      mockPrisma.caller.findUnique.mockResolvedValue({
        domainId: "comm-1",
      });
      mockPrisma.caller.update.mockResolvedValue({});

      const req = new NextRequest("http://localhost/api/communities/comm-1/members/caller-1", {
        method: "DELETE",
      });

      const res = await removeMember(req, p({ communityId: "comm-1", callerId: "caller-1" }));
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(mockPrisma.caller.update).toHaveBeenCalledWith({
        where: { id: "caller-1" },
        data: { domainId: null },
      });
    });

    it("returns 404 if community not found", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue(null);

      const req = new NextRequest("http://localhost/api/communities/nonexistent/members/caller-1", {
        method: "DELETE",
      });

      const res = await removeMember(req, p({ communityId: "nonexistent", callerId: "caller-1" }));
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toContain("Community not found");
    });

    it("returns 404 if caller not a member of community", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({ kind: "COMMUNITY" });
      mockPrisma.caller.findUnique.mockResolvedValue({
        domainId: "other-domain",
      });

      const req = new NextRequest("http://localhost/api/communities/comm-1/members/caller-1", {
        method: "DELETE",
      });

      const res = await removeMember(req, p({ communityId: "comm-1", callerId: "caller-1" }));
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toContain("Member not found");
    });
  });
});
