/**
 * Tests for `GET /api/callers/[callerId]/sub-skills` — #1662 (Epic #1606
 * Group C Phase 2).
 *
 * Pinned acceptance:
 *   1. Auth: returns the auth error when the session is unauthenticated
 *   2. Scope: STUDENT reading a foreign callerId → callerScopeMismatchResponse
 *   3. 404 when the caller doesn't exist
 *   4. Excludes `skill_*` parameters (those render in Skill Bands)
 *   5. Groups by Parameter.domainGroup; alphabetical group order
 *   6. Parameters inside a group sorted by name
 *   7. tier resolved via scoreToTier; null when currentScore is null
 *   8. exceedsTarget = true when currentScore > targetValue
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    caller: { findUnique: vi.fn() },
    callerTarget: { findMany: vi.fn() },
  },
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
  studentAllowedToReadCaller: () => true,
  callerScopeMismatchResponse: () =>
    new Response(JSON.stringify({ ok: false, error: "scope" }), { status: 403 }),
}));
vi.mock("@/lib/goals/track-progress", () => ({
  scoreToTier: (score: number) => {
    if (score >= 0.7) return { tier: "Secure", band: 3 };
    if (score >= 0.4) return { tier: "Developing", band: 2 };
    return { tier: "Emerging", band: 1 };
  },
}));

const PARAMS = { params: Promise.resolve({ callerId: "c1" }) };

async function loadRoute() {
  return import("@/app/api/callers/[callerId]/sub-skills/route");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/callers/[callerId]/sub-skills", () => {
  it("returns 404 when the caller does not exist", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue(null);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/sub-skills"), PARAMS);
    expect(res.status).toBe(404);
  });

  it("excludes skill_* parameters; groups by domainGroup", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.callerTarget.findMany.mockResolvedValue([
      {
        parameterId: "skill_speaking",
        targetValue: 0.7,
        currentScore: 0.6,
        callsUsed: 3,
        parameter: {
          parameterId: "skill_speaking",
          name: "Speaking",
          domainGroup: "skills",
        },
      },
      {
        parameterId: "warmth",
        targetValue: 0.6,
        currentScore: 0.8,
        callsUsed: 2,
        parameter: {
          parameterId: "warmth",
          name: "Warmth",
          domainGroup: "empathy",
        },
      },
      {
        parameterId: "directness",
        targetValue: 0.5,
        currentScore: 0.5,
        callsUsed: 1,
        parameter: {
          parameterId: "directness",
          name: "Directness",
          domainGroup: "communication",
        },
      },
      {
        parameterId: "personalization",
        targetValue: 0.5,
        currentScore: null,
        callsUsed: 0,
        parameter: {
          parameterId: "personalization",
          name: "Personalization",
          domainGroup: "empathy",
        },
      },
    ]);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/sub-skills"), PARAMS);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      groups: Array<{ domainGroup: string; parameters: Array<{ parameterId: string; tier: string | null; exceedsTarget: boolean }> }>;
    };
    expect(json.ok).toBe(true);

    // Alphabetical group order, skill_* excluded → "communication" + "empathy"
    expect(json.groups.map((g) => g.domainGroup)).toEqual([
      "communication",
      "empathy",
    ]);

    const empathy = json.groups.find((g) => g.domainGroup === "empathy")!;
    // Parameters inside the group sorted alphabetically by name
    expect(empathy.parameters.map((p) => p.parameterId)).toEqual([
      "personalization",
      "warmth",
    ]);

    // exceedsTarget true on warmth (0.8 > 0.6)
    const warmth = empathy.parameters.find((p) => p.parameterId === "warmth")!;
    expect(warmth.exceedsTarget).toBe(true);
    expect(warmth.tier).toBe("secure"); // scoreToTier(0.8) → Secure → lowercase

    // currentScore null → tier null + exceedsTarget false
    const personalization = empathy.parameters.find(
      (p) => p.parameterId === "personalization",
    )!;
    expect(personalization.tier).toBeNull();
    expect(personalization.exceedsTarget).toBe(false);
  });

  it("returns empty groups when caller has no CallerTargets", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.callerTarget.findMany.mockResolvedValue([]);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/sub-skills"), PARAMS);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { groups: unknown[] };
    expect(json.groups).toEqual([]);
  });

  it("returns empty groups when every CallerTarget is a skill_* parameter", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.callerTarget.findMany.mockResolvedValue([
      {
        parameterId: "skill_listening",
        targetValue: 0.7,
        currentScore: 0.6,
        callsUsed: 1,
        parameter: {
          parameterId: "skill_listening",
          name: "Listening",
          domainGroup: "skills",
        },
      },
    ]);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/sub-skills"), PARAMS);
    const json = (await res.json()) as { groups: unknown[] };
    expect(json.groups).toEqual([]);
  });

  it("falls back to 'other' bucket when a parameter has no domainGroup", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.callerTarget.findMany.mockResolvedValue([
      {
        parameterId: "p1",
        targetValue: 0.5,
        currentScore: 0.5,
        callsUsed: 1,
        parameter: { parameterId: "p1", name: "P1", domainGroup: null },
      },
    ]);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/sub-skills"), PARAMS);
    const json = (await res.json()) as { groups: Array<{ domainGroup: string }> };
    expect(json.groups[0].domainGroup).toBe("other");
  });
});
