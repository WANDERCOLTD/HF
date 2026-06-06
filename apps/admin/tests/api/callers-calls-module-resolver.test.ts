/**
 * #491 E1 Slice 1.1 — resolve requestedModuleId slug → CurriculumModule.id at call-create.
 *
 * Without this, picker chips that pass a slug ("mock", "part2") get stored verbatim
 * on Call.requestedModuleId but never resolved to Call.curriculumModuleId. The composer
 * reads curriculumModuleId; result: scheduler workingSet falls to Part 1 every call,
 * tutor ignores the pick, and ~40KB of curriculumAssertions render unnecessarily.
 *
 * Tests cover: clean slug resolution, UUID passthrough, slug-not-in-curriculum (400),
 * curriculum-doesnt-exist-for-playbook (400), no-requestedModuleId path (legacy, OK).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  caller: { findUnique: vi.fn() },
  call: {
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  curriculum: { findFirst: vi.fn() },
  curriculumModule: { findFirst: vi.fn() },
  // Added 2026-06-04: resolveCurriculumIdForPlaybook from #1034 reads
  // PlaybookCurriculum to map playbookId → curriculumId. Without this
  // mock the test 500s on "Cannot read properties of undefined".
  playbookCurriculum: { findFirst: vi.fn() },
}));

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockIsAuthError = vi.hoisted(() => vi.fn().mockReturnValue(false));
const mockResolvePlaybookId = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
}));

vi.mock("@/lib/enrollment/resolve-playbook", () => ({
  resolvePlaybookId: (...args: unknown[]) => mockResolvePlaybookId(...args),
}));

import { POST } from "@/app/api/callers/[callerId]/calls/route";

const CALLER = "11111111-1111-1111-1111-111111111111";
const PLAYBOOK = "22222222-2222-2222-2222-222222222222";
const CURRICULUM = "33333333-3333-3333-3333-333333333333";
const MOCK_MOD_ID = "44444444-4444-4444-4444-444444444444";

function makeReq(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/callers/${CALLER}/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

const params = Promise.resolve({ callerId: CALLER });

describe("POST /api/callers/[callerId]/calls — module slug resolver (#491 Slice 1.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ session: { user: { id: "u1" } } });
    mockIsAuthError.mockReturnValue(false);
    mockResolvePlaybookId.mockResolvedValue(PLAYBOOK);
    mockPrisma.caller.findUnique.mockResolvedValue({ id: CALLER });
    mockPrisma.call.findFirst.mockResolvedValue(null);
    mockPrisma.call.create.mockResolvedValue({
      id: "call-1",
      callSequence: 1,
      source: "ai-simulation",
      createdAt: new Date(),
    });
  });

  it("resolves a slug to CurriculumModule.id and writes both fields", async () => {
    // #1177 Slice 6 — resolveCurriculumIdForPlaybook reads PlaybookCurriculum
    // (canonical-only after the column drop).
    mockPrisma.playbookCurriculum.findFirst.mockResolvedValue({ curriculumId: CURRICULUM });
    mockPrisma.curriculumModule.findFirst.mockResolvedValue({ id: MOCK_MOD_ID });

    const res = await POST(makeReq({ requestedModuleId: "mock" }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockPrisma.call.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestedModuleId: "mock",
          curriculumModuleId: MOCK_MOD_ID,
        }),
      })
    );
  });

  it("returns 400 when curriculum doesn't exist for the playbook", async () => {
    mockPrisma.playbookCurriculum.findFirst.mockResolvedValue(null);

    const res = await POST(makeReq({ requestedModuleId: "mock" }), { params });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/no curriculum yet/i);
    expect(mockPrisma.call.create).not.toHaveBeenCalled();
  });

  it("returns 400 when the slug doesn't resolve to a module in this curriculum", async () => {
    mockPrisma.playbookCurriculum.findFirst.mockResolvedValue({ curriculumId: CURRICULUM });
    mockPrisma.curriculumModule.findFirst.mockResolvedValue(null);

    const res = await POST(makeReq({ requestedModuleId: "typo-slug" }), { params });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/not found in this course's curriculum/i);
    expect(mockPrisma.call.create).not.toHaveBeenCalled();
  });

  it("call-create works when requestedModuleId is absent (legacy path)", async () => {
    const res = await POST(makeReq({}), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockPrisma.curriculum.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.curriculumModule.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.call.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          requestedModuleId: expect.anything(),
        }),
      })
    );
  });
});
