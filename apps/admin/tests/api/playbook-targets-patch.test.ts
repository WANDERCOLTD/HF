/**
 * Tests for PATCH /api/playbooks/:playbookId/targets
 *
 * Covers #602 — PUBLISHED guard lifted, parameterId whitelist enforced.
 * PLAYBOOK-scope BehaviorTarget rows are an operational overlay applied at
 * composition time, so edits are safe on PUBLISHED playbooks (targets read
 * live, not snapshot per call).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// =====================================================
// MOCK DATA
// =====================================================

const publishedPlaybook = {
  id: "pb-1",
  name: "IELTS Prep Lab",
  status: "PUBLISHED",
};

const draftPlaybook = {
  id: "pb-2",
  name: "Draft Playbook",
  status: "DRAFT",
};

const adjustableParams = [
  { parameterId: "BEH-WARMTH" },
  { parameterId: "BEH-CHALLENGE-LEVEL" },
  { parameterId: "BEH-FORMALITY" },
];

// =====================================================
// MOCKS
// =====================================================

const mockPrisma = {
  playbook: { findUnique: vi.fn() },
  parameter: { findMany: vi.fn() },
  behaviorTarget: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

const mockRequireAuth = vi.fn();
const mockIsAuthError = vi.fn();
vi.mock("@/lib/permissions", () => ({
  requireAuth: mockRequireAuth,
  isAuthError: mockIsAuthError,
}));

// =====================================================
// HELPERS
// =====================================================

function makeRequest(playbookId: string, body: unknown): NextRequest {
  return new Request(`http://localhost/api/playbooks/${playbookId}/targets`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as unknown as NextRequest;
}

function makeParams(playbookId: string) {
  return { params: Promise.resolve({ playbookId }) };
}

// =====================================================
// TESTS
// =====================================================

describe("PATCH /api/playbooks/:playbookId/targets", () => {
  let PATCH: typeof import("../../app/api/playbooks/[playbookId]/targets/route").PATCH;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockIsAuthError.mockReturnValue(false);
    mockRequireAuth.mockResolvedValue({
      session: {
        user: { id: "u-1", email: "a@b.com", name: "Op", role: "OPERATOR", image: null },
        expires: new Date(Date.now() + 86400000).toISOString(),
      },
    });

    mockPrisma.parameter.findMany.mockResolvedValue(adjustableParams);
    mockPrisma.behaviorTarget.findFirst.mockResolvedValue(null);
    mockPrisma.behaviorTarget.create.mockResolvedValue({ id: "bt-new" });
    mockPrisma.behaviorTarget.update.mockResolvedValue({ id: "bt-upd" });
    mockPrisma.behaviorTarget.delete.mockResolvedValue({ id: "bt-del" });

    const mod = await import(
      "../../app/api/playbooks/[playbookId]/targets/route"
    );
    PATCH = mod.PATCH;
  });

  it("writes targets on a PUBLISHED playbook (the demo-day blocker)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(publishedPlaybook);

    const response = await PATCH(
      makeRequest("pb-1", {
        targets: [{ parameterId: "BEH-CHALLENGE-LEVEL", targetValue: 0.51 }],
      }),
      makeParams("pb-1"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results).toEqual([
      { parameterId: "BEH-CHALLENGE-LEVEL", action: "created", value: 0.51 },
    ]);
    expect(mockPrisma.behaviorTarget.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        parameterId: "BEH-CHALLENGE-LEVEL",
        playbookId: "pb-1",
        scope: "PLAYBOOK",
        targetValue: 0.51,
        source: "MANUAL",
      }),
    });
  });

  it("rejects hallucinated parameterIds without writing them", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(draftPlaybook);

    const response = await PATCH(
      makeRequest("pb-2", {
        targets: [
          { parameterId: "BEH-WARMTH", targetValue: 0.7 },
          { parameterId: "BEH-NONEXISTENT", targetValue: 0.5 },
        ],
      }),
      makeParams("pb-2"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results).toHaveLength(1);
    expect(data.results[0].parameterId).toBe("BEH-WARMTH");
    expect(data.rejected).toEqual([
      { parameterId: "BEH-NONEXISTENT", reason: "not an adjustable BEHAVIOR parameter" },
    ]);
    expect(mockPrisma.behaviorTarget.create).toHaveBeenCalledTimes(1);
  });

  it("clamps targetValue into [0, 1]", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(draftPlaybook);

    await PATCH(
      makeRequest("pb-2", {
        targets: [
          { parameterId: "BEH-WARMTH", targetValue: 1.7 },
          { parameterId: "BEH-FORMALITY", targetValue: -0.3 },
        ],
      }),
      makeParams("pb-2"),
    );

    const calls = mockPrisma.behaviorTarget.create.mock.calls;
    expect(calls[0][0].data.targetValue).toBe(1);
    expect(calls[1][0].data.targetValue).toBe(0);
  });

  it("removes the playbook override when targetValue is null", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(publishedPlaybook);
    mockPrisma.behaviorTarget.findFirst.mockResolvedValue({ id: "bt-existing" });

    const response = await PATCH(
      makeRequest("pb-1", {
        targets: [{ parameterId: "BEH-WARMTH", targetValue: null }],
      }),
      makeParams("pb-1"),
    );
    const data = await response.json();

    expect(data.results).toEqual([{ parameterId: "BEH-WARMTH", action: "removed" }]);
    expect(mockPrisma.behaviorTarget.delete).toHaveBeenCalledWith({
      where: { id: "bt-existing" },
    });
  });

  it("returns 404 for a non-existent playbook", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);

    const response = await PATCH(
      makeRequest("pb-x", {
        targets: [{ parameterId: "BEH-WARMTH", targetValue: 0.5 }],
      }),
      makeParams("pb-x"),
    );

    expect(response.status).toBe(404);
    expect(mockPrisma.behaviorTarget.create).not.toHaveBeenCalled();
  });

  it("returns 400 when targets is not an array", async () => {
    const response = await PATCH(
      makeRequest("pb-1", { targets: "not-an-array" }),
      makeParams("pb-1"),
    );

    expect(response.status).toBe(400);
  });

  it("rejects unauthenticated requests", async () => {
    mockIsAuthError.mockReturnValue(true);
    mockRequireAuth.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    });

    const response = await PATCH(
      makeRequest("pb-1", {
        targets: [{ parameterId: "BEH-WARMTH", targetValue: 0.5 }],
      }),
      makeParams("pb-1"),
    );

    expect(response.status).toBe(401);
    expect(mockPrisma.behaviorTarget.create).not.toHaveBeenCalled();
  });
});
