/**
 * Tests for `GET /api/calls/[callId]/post-call-redirect`.
 *
 * Pinned acceptance:
 *   1. STUDENT scope rejects foreign callerId (403)
 *   2. 404 when call not found
 *   3. Mock-style call (coversModules.length > 0) returns
 *      `/x/student/<playbookId>/results/<sessionId>`
 *   4. Non-Mock call (coversModules empty / module absent) returns
 *      `/x/student` fallback
 *   5. Missing playbookId or sessionId returns `/x/student` fallback
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, mockStudentAllowed } = vi.hoisted(() => ({
  mockPrisma: {
    call: { findUnique: vi.fn() },
  },
  mockStudentAllowed: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    session: { user: { id: "u1", role: "OPERATOR" } },
  })),
  isAuthError: () => false,
}));
vi.mock("@/lib/learner-scope", () => ({
  studentAllowedToReadCaller: mockStudentAllowed,
  callerScopeMismatchResponse: () =>
    new Response(JSON.stringify({ ok: false, error: "scope" }), { status: 403 }),
}));

const PARAMS = { params: Promise.resolve({ callId: "call-1" }) };

async function loadRoute() {
  return import("@/app/api/calls/[callId]/post-call-redirect/route");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStudentAllowed.mockReturnValue(true);
});

describe("GET /api/calls/[callId]/post-call-redirect", () => {
  it("rejects STUDENT reading foreign call (403)", async () => {
    mockStudentAllowed.mockReturnValue(false);
    mockPrisma.call.findUnique.mockResolvedValue({
      callerId: "caller-1",
      playbookId: "pb-1",
      sessionId: "sess-1",
      curriculumModule: { coversModules: ["part1", "part2", "part3"] },
    });
    const route = await loadRoute();
    const res = await route.GET(new NextRequest("http://x"), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 404 when call not found", async () => {
    mockPrisma.call.findUnique.mockResolvedValue(null);
    const route = await loadRoute();
    const res = await route.GET(new NextRequest("http://x"), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns Mock Results URL when coversModules.length > 0", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({
      callerId: "caller-1",
      playbookId: "pb-1",
      sessionId: "sess-1",
      curriculumModule: { coversModules: ["part1", "part2", "part3"] },
    });
    const route = await loadRoute();
    const res = await route.GET(new NextRequest("http://x"), PARAMS);
    const body = (await res.json()) as { ok: true; target: string };
    expect(res.status).toBe(200);
    expect(body.target).toBe("/x/student/pb-1/results/sess-1");
  });

  it("returns /x/student fallback for non-Mock call (coversModules empty)", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({
      callerId: "caller-1",
      playbookId: "pb-1",
      sessionId: "sess-1",
      curriculumModule: { coversModules: [] },
    });
    const route = await loadRoute();
    const res = await route.GET(new NextRequest("http://x"), PARAMS);
    const body = (await res.json()) as { ok: true; target: string };
    expect(body.target).toBe("/x/student");
  });

  it("returns /x/student fallback when curriculumModule is null (regular tutor call)", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({
      callerId: "caller-1",
      playbookId: "pb-1",
      sessionId: "sess-1",
      curriculumModule: null,
    });
    const route = await loadRoute();
    const res = await route.GET(new NextRequest("http://x"), PARAMS);
    const body = (await res.json()) as { ok: true; target: string };
    expect(body.target).toBe("/x/student");
  });

  it("returns /x/student fallback when sessionId is missing (orphan Call)", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({
      callerId: "caller-1",
      playbookId: "pb-1",
      sessionId: null,
      curriculumModule: { coversModules: ["part1"] },
    });
    const route = await loadRoute();
    const res = await route.GET(new NextRequest("http://x"), PARAMS);
    const body = (await res.json()) as { ok: true; target: string };
    expect(body.target).toBe("/x/student");
  });

  it("returns /x/student fallback when playbookId is missing", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({
      callerId: "caller-1",
      playbookId: null,
      sessionId: "sess-1",
      curriculumModule: { coversModules: ["part1"] },
    });
    const route = await loadRoute();
    const res = await route.GET(new NextRequest("http://x"), PARAMS);
    const body = (await res.json()) as { ok: true; target: string };
    expect(body.target).toBe("/x/student");
  });
});
