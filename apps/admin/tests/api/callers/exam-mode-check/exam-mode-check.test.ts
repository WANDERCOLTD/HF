/**
 * Tests for `GET /api/callers/[callerId]/exam-mode-check?moduleSlug=…`.
 *
 * Pinned acceptance:
 *   1. STUDENT scope rejects foreign callerId (403)
 *   2. No moduleSlug → `{ examMode: false }`
 *   3. No active enrollment → `{ examMode: false }`
 *   4. Module not found → `{ examMode: false }`
 *   5. Module with empty coversModules → `{ examMode: false }`
 *   6. Module with coversModules.length > 0 → `{ examMode: true }`
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, mockStudentAllowed } = vi.hoisted(() => ({
  mockPrisma: {
    callerPlaybook: { findFirst: vi.fn() },
    curriculumModule: { findFirst: vi.fn() },
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

const PARAMS = { params: Promise.resolve({ callerId: "caller-1" }) };

async function loadRoute() {
  return import("@/app/api/callers/[callerId]/exam-mode-check/route");
}

function makeReq(slug?: string): NextRequest {
  const url = slug
    ? `http://x?moduleSlug=${encodeURIComponent(slug)}`
    : "http://x";
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStudentAllowed.mockReturnValue(true);
});

describe("GET /api/callers/[callerId]/exam-mode-check", () => {
  it("rejects STUDENT reading foreign caller (403)", async () => {
    mockStudentAllowed.mockReturnValue(false);
    const route = await loadRoute();
    const res = await route.GET(makeReq("mock"), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns examMode:false when moduleSlug is absent", async () => {
    const route = await loadRoute();
    const res = await route.GET(makeReq(), PARAMS);
    const body = (await res.json()) as { examMode: boolean };
    expect(body.examMode).toBe(false);
    expect(mockPrisma.callerPlaybook.findFirst).not.toHaveBeenCalled();
  });

  it("returns examMode:false when caller has no active enrollment", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
    const route = await loadRoute();
    const res = await route.GET(makeReq("mock"), PARAMS);
    const body = (await res.json()) as { examMode: boolean };
    expect(body.examMode).toBe(false);
  });

  it("returns examMode:false when module not found in curriculum", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbook: { playbookCurricula: [{ curriculumId: "cur-1" }] },
    });
    mockPrisma.curriculumModule.findFirst.mockResolvedValue(null);
    const route = await loadRoute();
    const res = await route.GET(makeReq("ghost"), PARAMS);
    const body = (await res.json()) as { examMode: boolean };
    expect(body.examMode).toBe(false);
  });

  it("returns examMode:false for module with empty coversModules", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbook: { playbookCurricula: [{ curriculumId: "cur-1" }] },
    });
    mockPrisma.curriculumModule.findFirst.mockResolvedValue({
      coversModules: [],
    });
    const route = await loadRoute();
    const res = await route.GET(makeReq("part1"), PARAMS);
    const body = (await res.json()) as { examMode: boolean };
    expect(body.examMode).toBe(false);
  });

  it("returns examMode:true for module with non-empty coversModules", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbook: { playbookCurricula: [{ curriculumId: "cur-1" }] },
    });
    mockPrisma.curriculumModule.findFirst.mockResolvedValue({
      coversModules: ["part1", "part2", "part3"],
    });
    const route = await loadRoute();
    const res = await route.GET(makeReq("mock"), PARAMS);
    const body = (await res.json()) as { examMode: boolean };
    expect(body.examMode).toBe(true);
  });
});
