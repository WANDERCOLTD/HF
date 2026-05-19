/**
 * Tests for the #495 Slice 4.5 prereq surface in
 * GET /api/courses/[courseId]/import-modules.
 *
 * The route must expose enough information for the learner picker to
 * detect unmet prereqs client-side without a second round-trip:
 *
 *   1. `strictPrerequisites: boolean` at top level — derived from
 *      `readCourseFlags(playbook.config).strictPrerequisites` so the
 *      default-false invariant is preserved across legacy rows.
 *   2. Per-module `prerequisites: string[]` — normalised to `[]` when
 *      the JSON shape omits the field (legacy data), passed through
 *      unchanged otherwise.
 *
 * Wiring only — the actual soft-warning UX is exercised in
 * `__tests__/ui/learner-module-picker-soft-warning.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ────────────────────────────────────────────────────────

const { mockPrisma, mockRequireAuth, mockIsAuthError } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: {
      findUnique: vi.fn(),
    },
    curriculum: {
      findFirst: vi.fn(),
    },
    curriculumModule: {
      findMany: vi.fn(),
    },
    contentQuestion: {
      groupBy: vi.fn(),
    },
    learningObjective: {
      findMany: vi.fn(),
    },
    caller: {
      findFirst: vi.fn(),
    },
    callerModuleProgress: {
      findMany: vi.fn(),
    },
  },
  mockRequireAuth: vi.fn(),
  mockIsAuthError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
  ROLE_LEVEL: {
    DEMO: 0,
    VIEWER: 1,
    TESTER: 1,
    STUDENT: 1,
    SUPER_TESTER: 2,
    OPERATOR: 3,
    EDUCATOR: 3,
    ADMIN: 4,
    SUPERADMIN: 5,
  },
}));

// Recommendation overlay is out of scope here — stub null so the route's
// extra top-level fields stay deterministic.
vi.mock("@/lib/curriculum/recommend-next-module", () => ({
  recommendNextModule: vi.fn().mockResolvedValue(null),
}));

// Import AFTER mocks
import { GET } from "@/app/api/courses/[courseId]/import-modules/route";

// ── Helpers ──────────────────────────────────────────────────────

function makeGetReq(query?: string): NextRequest {
  const url = `http://localhost:3000/api/courses/playbook-1/import-modules${query ? `?${query}` : ""}`;
  return new NextRequest(url);
}

const params = Promise.resolve({ courseId: "playbook-1" });

// Two modules: one declares prereqs, the other OMITS the field entirely
// (legacy / hand-edited row) so we can prove the route defaults to [].
const playbookWithMixedPrereqs = (
  strictPrerequisites: boolean | undefined,
) => ({
  id: "playbook-1",
  config: {
    modulesAuthored: true,
    moduleSource: "authored",
    ...(strictPrerequisites === undefined
      ? {}
      : { strictPrerequisites }),
    modules: [
      {
        id: "m1",
        label: "Module One",
        learnerSelectable: true,
        mode: "tutor",
        duration: "Student-led",
        scoringFired: "LR + GRA only",
        voiceBandReadout: false,
        sessionTerminal: false,
        frequency: "repeatable",
        outcomesPrimary: [],
        // prereqs field absent — must default to []
      },
      {
        id: "m2",
        label: "Module Two",
        learnerSelectable: true,
        mode: "tutor",
        duration: "20 min",
        scoringFired: "All four",
        voiceBandReadout: false,
        sessionTerminal: false,
        frequency: "repeatable",
        outcomesPrimary: [],
        prerequisites: ["m1"],
      },
    ],
  },
});

beforeEach(() => {
  mockRequireAuth.mockReset();
  mockIsAuthError.mockReset();
  mockPrisma.playbook.findUnique.mockReset();
  mockPrisma.curriculum.findFirst.mockReset();
  mockPrisma.curriculumModule.findMany.mockReset();
  mockPrisma.contentQuestion.groupBy.mockReset();
  mockPrisma.learningObjective.findMany.mockReset();
  mockPrisma.caller.findFirst.mockReset();
  mockPrisma.callerModuleProgress.findMany.mockReset();

  mockIsAuthError.mockReturnValue(false);
  mockPrisma.contentQuestion.groupBy.mockResolvedValue([]);
  mockPrisma.learningObjective.findMany.mockResolvedValue([]);
  mockPrisma.curriculum.findFirst.mockResolvedValue(null);
  mockPrisma.curriculumModule.findMany.mockResolvedValue([]);
});

// ── Case 1: strictPrerequisites surfaced from playbook config ────

describe("GET /api/courses/[id]/import-modules — strictPrerequisites top-level (#495 Slice 4.5)", () => {
  it("reflects the explicit config value when set to true", async () => {
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "admin-1", role: "OPERATOR" } },
    });
    mockPrisma.playbook.findUnique.mockResolvedValue(
      playbookWithMixedPrereqs(true),
    );

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strictPrerequisites).toBe(true);
  });

  it("reflects the explicit config value when set to false", async () => {
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "admin-1", role: "OPERATOR" } },
    });
    mockPrisma.playbook.findUnique.mockResolvedValue(
      playbookWithMixedPrereqs(false),
    );

    const res = await GET(makeGetReq(), { params });
    const body = await res.json();
    expect(body.strictPrerequisites).toBe(false);
  });

  it("defaults to false when the playbook omits the flag entirely", async () => {
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "admin-1", role: "OPERATOR" } },
    });
    // omit -> readCourseFlags applies DEFAULT_STRICT_PREREQUISITES (false)
    mockPrisma.playbook.findUnique.mockResolvedValue(
      playbookWithMixedPrereqs(undefined),
    );

    const res = await GET(makeGetReq(), { params });
    const body = await res.json();
    expect(body.strictPrerequisites).toBe(false);
  });
});

// ── Case 2: per-module prereqs normalised ────────────────────────

describe("GET /api/courses/[id]/import-modules — module.prerequisites normalisation (#495 Slice 4.5)", () => {
  it("defaults the prerequisites field to [] when authored JSON omits it", async () => {
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "admin-1", role: "OPERATOR" } },
    });
    mockPrisma.playbook.findUnique.mockResolvedValue(
      playbookWithMixedPrereqs(false),
    );

    const res = await GET(makeGetReq(), { params });
    const body = await res.json();
    expect(body.modules[0].id).toBe("m1");
    expect(body.modules[0].prerequisites).toEqual([]);
  });

  it("passes through a declared prerequisites array unchanged", async () => {
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "admin-1", role: "OPERATOR" } },
    });
    mockPrisma.playbook.findUnique.mockResolvedValue(
      playbookWithMixedPrereqs(false),
    );

    const res = await GET(makeGetReq(), { params });
    const body = await res.json();
    expect(body.modules[1].id).toBe("m2");
    expect(body.modules[1].prerequisites).toEqual(["m1"]);
  });
});
