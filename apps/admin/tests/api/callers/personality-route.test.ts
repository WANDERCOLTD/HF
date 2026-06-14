/**
 * Tests for `GET /api/callers/[callerId]/personality` — #1665 (Epic
 * #1606 Group C Phase 3, folded A.7).
 *
 * Pinned acceptance:
 *   1. STUDENT scope rejects foreign callerId.
 *   2. 404 when caller not found.
 *   3. `profile: null` when CallerPersonalityProfile row is absent.
 *   4. Joined Parameter.name + domainGroup populate per entry.
 *   5. Falls back to "other" domainGroup when Parameter row missing.
 *   6. Skips non-numeric values from parameterValues.
 *   7. Decision 5 contract pin — Parameter.interpretationHigh/Low
 *      NEVER appear in the response.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockStudentAllowed } = vi.hoisted(() => ({
  mockPrisma: {
    caller: { findUnique: vi.fn() },
    callerPersonalityProfile: { findUnique: vi.fn() },
    parameter: { findMany: vi.fn() },
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

const PARAMS = { params: Promise.resolve({ callerId: "c1" }) };

async function loadRoute() {
  return import("@/app/api/callers/[callerId]/personality/route");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStudentAllowed.mockReturnValue(true);
});

describe("GET /api/callers/[callerId]/personality", () => {
  it("returns 403 when STUDENT scope rejects the caller", async () => {
    mockStudentAllowed.mockReturnValue(false);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/personality"), PARAMS);
    expect(res.status).toBe(403);
    expect(mockPrisma.caller.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when caller does not exist", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue(null);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/personality"), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns profile: null when no CallerPersonalityProfile row exists", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.callerPersonalityProfile.findUnique.mockResolvedValue(null);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/personality"), PARAMS);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { profile: unknown };
    expect(json.profile).toBeNull();
  });

  it("joins parameter names + domainGroups; sorts by group then name", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.callerPersonalityProfile.findUnique.mockResolvedValue({
      parameterValues: {
        "B5-O": 0.72,
        "B5-C": 0.65,
        engagement: 0.8,
      },
      lastUpdatedAt: new Date("2026-06-14T09:00:00.000Z"),
      callsUsed: 4,
      specsUsed: 2,
    });
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "B5-O", name: "Openness", domainGroup: "big_five" },
      { parameterId: "B5-C", name: "Conscientiousness", domainGroup: "big_five" },
      { parameterId: "engagement", name: "Engagement", domainGroup: "behavior" },
    ]);

    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/personality"), PARAMS);
    const json = (await res.json()) as {
      profile: {
        parameters: Array<{
          parameterId: string;
          name: string;
          domainGroup: string;
          value: number;
        }>;
        callsUsed: number;
        specsUsed: number;
      };
    };

    expect(json.profile.parameters.length).toBe(3);
    // behavior < big_five alphabetically
    expect(json.profile.parameters[0].domainGroup).toBe("behavior");
    expect(json.profile.parameters[0].name).toBe("Engagement");
    // Within big_five: Conscientiousness < Openness alphabetically
    expect(json.profile.parameters[1].name).toBe("Conscientiousness");
    expect(json.profile.parameters[2].name).toBe("Openness");
    expect(json.profile.callsUsed).toBe(4);
    expect(json.profile.specsUsed).toBe(2);
  });

  it("falls back to 'other' domainGroup when Parameter row missing for a JSON key", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.callerPersonalityProfile.findUnique.mockResolvedValue({
      parameterValues: { orphan_param: 0.5 },
      lastUpdatedAt: null,
      callsUsed: 1,
      specsUsed: 0,
    });
    mockPrisma.parameter.findMany.mockResolvedValue([]);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/personality"), PARAMS);
    const json = (await res.json()) as {
      profile: { parameters: Array<{ domainGroup: string; name: string }> };
    };
    expect(json.profile.parameters[0].domainGroup).toBe("other");
    expect(json.profile.parameters[0].name).toBe("orphan_param");
  });

  it("skips non-numeric values from parameterValues", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.callerPersonalityProfile.findUnique.mockResolvedValue({
      parameterValues: {
        good: 0.5,
        bad_string: "high",
        bad_null: null,
        bad_nan: NaN,
      },
      lastUpdatedAt: null,
      callsUsed: 0,
      specsUsed: 0,
    });
    mockPrisma.parameter.findMany.mockResolvedValue([]);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/personality"), PARAMS);
    const json = (await res.json()) as {
      profile: { parameters: Array<{ parameterId: string }> };
    };
    expect(json.profile.parameters.map((p) => p.parameterId)).toEqual(["good"]);
  });

  it("Decision 5: does NOT return Parameter.interpretationHigh/Low", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.callerPersonalityProfile.findUnique.mockResolvedValue({
      parameterValues: { "B5-O": 0.72 },
      lastUpdatedAt: null,
      callsUsed: 1,
      specsUsed: 0,
    });
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "B5-O", name: "Openness", domainGroup: "big_five" },
    ]);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/personality"), PARAMS);
    const json = (await res.json()) as {
      profile: { parameters: Array<Record<string, unknown>> };
    };
    expect(json.profile.parameters[0].interpretationHigh).toBeUndefined();
    expect(json.profile.parameters[0].interpretationLow).toBeUndefined();

    // Also verify the route asked Prisma for `name + domainGroup` ONLY —
    // not the interpretation columns. This pins the contract at the
    // query level too.
    const findManyCall = mockPrisma.parameter.findMany.mock.calls[0][0] as {
      select: Record<string, boolean>;
    };
    expect(findManyCall.select.interpretationHigh).toBeUndefined();
    expect(findManyCall.select.interpretationLow).toBeUndefined();
    expect(findManyCall.select.name).toBe(true);
    expect(findManyCall.select.domainGroup).toBe(true);
  });
});
