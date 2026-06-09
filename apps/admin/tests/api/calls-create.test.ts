/**
 * Tests for POST /api/callers/:callerId/calls
 *
 * Specifically the playbookId resolution behaviour added by #202:
 *   - Explicit body.playbookId wins
 *   - Missing → resolve from caller's default enrollment
 *   - Unresolvable (multi-enroll, no default) → 400
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  caller: { findUnique: vi.fn() },
  call: { findFirst: vi.fn(), create: vi.fn() },
  callerPlaybook: { findFirst: vi.fn(), findMany: vi.fn() },
  // resolveDefaultModuleForCaller chain (#1154/G6) — null returns let the
  // resolver short-circuit gracefully so playbookId resolution stays the
  // unit under test.
  playbookCurriculum: { findFirst: vi.fn().mockResolvedValue(null) },
  callerModuleProgress: { findFirst: vi.fn().mockResolvedValue(null) },
  curriculumModule: { findFirst: vi.fn().mockResolvedValue(null) },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({ session: { user: { id: "u1", role: "ADMIN" } } }),
  isAuthError: vi.fn(() => false),
}));

// #1344 Slice 4 — POST creates a SIM_CALL Session parent row via
// `createSession` before writing the Call. Mock to a deterministic id so
// the route reaches `prisma.call.create` (the unit under test) instead of
// the real (Prisma-driven) Session writer.
vi.mock("@/lib/voice/create-session", () => ({
  createSession: vi.fn().mockResolvedValue({ session: { id: "session-1" } }),
}));

const buildRequest = (body: Record<string, unknown>): NextRequest => {
  return {
    json: async () => body,
  } as unknown as NextRequest;
};

const params = (callerId: string) =>
  ({ params: Promise.resolve({ callerId }) }) as { params: Promise<{ callerId: string }> };

type RouteHandler = (req: NextRequest, ctx: { params: Promise<{ callerId: string }> }) => Promise<Response>;

describe("POST /api/callers/:callerId/calls — playbookId resolution", () => {
  let POST: RouteHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alice" });
    mockPrisma.call.findFirst.mockResolvedValue(null); // no previous call
    mockPrisma.call.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: "new-call",
        // #1344 Slice 4 — `Call.callSequence` dropped; sequencing now lives
        // on `Session.learnerFacingNumber`. The route no longer writes
        // `callSequence`, so it's no longer surfaced on the create result.
        source: data.source,
        createdAt: new Date(),
        playbookId: data.playbookId,
      })
    );

    const mod = await import("@/app/api/callers/[callerId]/calls/route");
    POST = mod.POST;
  });

  it("uses explicit body.playbookId without consulting enrollment", async () => {
    const req = buildRequest({ source: "sim", playbookId: "explicit-pb-1" });
    const res = await POST(req, params("c1"));

    expect(res.status).toBe(200);
    expect(mockPrisma.call.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ playbookId: "explicit-pb-1" }),
      })
    );
    // resolvePlaybookId short-circuits on explicit, so callerPlaybook isn't queried
    expect(mockPrisma.callerPlaybook.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to caller's default enrollment when body has no playbookId", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ playbookId: "default-pb-1" });

    const req = buildRequest({ source: "sim" });
    const res = await POST(req, params("c1"));

    expect(res.status).toBe(200);
    expect(mockPrisma.call.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ playbookId: "default-pb-1" }),
      })
    );
  });

  it("falls back to single-active enrollment when no default", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([{ playbookId: "only-pb-1" }]);

    const req = buildRequest({ source: "sim" });
    const res = await POST(req, params("c1"));

    expect(res.status).toBe(200);
    expect(mockPrisma.call.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ playbookId: "only-pb-1" }),
      })
    );
  });

  it("returns 400 when caller has multiple active enrollments and no default", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([
      { playbookId: "pb-a" },
      { playbookId: "pb-b" },
    ]);

    const req = buildRequest({ source: "sim" });
    const res = await POST(req, params("c1"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/playbookId/i);
    expect(mockPrisma.call.create).not.toHaveBeenCalled();
  });

  it("returns 400 when caller has no active enrollment", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([]);

    const req = buildRequest({ source: "sim" });
    const res = await POST(req, params("c1"));

    expect(res.status).toBe(400);
    expect(mockPrisma.call.create).not.toHaveBeenCalled();
  });

  it("returns 404 when caller does not exist", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue(null);

    const req = buildRequest({ source: "sim", playbookId: "pb-1" });
    const res = await POST(req, params("missing"));

    expect(res.status).toBe(404);
    expect(mockPrisma.call.create).not.toHaveBeenCalled();
  });
});
