/**
 * #911 — `GET /api/callers/[callerId]/effective-behavior-targets` route tests.
 *
 * Verifies the four contract points from the issue body:
 *   1. Valid playbookId returns 200 + cascade-merged parameter array.
 *   2. Missing playbookId returns 400.
 *   3. Missing auth returns the auth helper's error response (401/403).
 *   4. End-to-end with a CALLER-scope BehaviorTarget row: the response reports
 *      the override value for that parameter (golden-caller fixture).
 *
 * Mocks the canonical primitives at the module boundary so the test focuses
 * on the route adapter (zod / 400 / auth wiring) plus the helper's contract,
 * rather than re-running the helper's full unit suite.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  behaviorTarget: { findMany: vi.fn() },
  // #1949 — the cascade reader now also reads Parameter for alias +
  // deprecation resolution. Default to empty array so tests that don't
  // populate it get clean canonical pass-through.
  parameter: { findMany: vi.fn().mockResolvedValue([]) },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// #1949 — clear the alias resolver's module-level cache between tests
// so the empty-array mock above is re-read on each it() block.
import { clearAliasCache } from "@/lib/registry/resolve";

const mockResolveCallerIdentityIds = vi.fn();
vi.mock("@/lib/agent-tuner/write-target", () => ({
  resolveCallerIdentityIds: mockResolveCallerIdentityIds,
}));

const mockRequireAuth = vi.fn();
const mockIsAuthError = vi.fn();
vi.mock("@/lib/permissions", () => ({
  requireAuth: mockRequireAuth,
  isAuthError: mockIsAuthError,
}));

// Golden-caller fixture documented in MEMORY.md.
const GOLDEN_CALLER_ID = "f17d8616-3c31-4814-8de1-626fb42f16f6";
const PLAYBOOK_ID = "playbook-test-001";

const ROUTE_URL = `http://localhost:3000/api/callers/${GOLDEN_CALLER_ID}/effective-behavior-targets`;

function makeRequest(playbookId: string | null) {
  const u = new URL(ROUTE_URL);
  if (playbookId !== null) u.searchParams.set("playbookId", playbookId);
  return new NextRequest(u.toString());
}

function makeParams() {
  return Promise.resolve({ callerId: GOLDEN_CALLER_ID });
}

describe("/api/callers/[callerId]/effective-behavior-targets — GET (#911)", () => {
  let GET: typeof import("../../app/api/callers/[callerId]/effective-behavior-targets/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    // #1949 — clear the alias resolver's module-level cache so the
    // empty-array mock for prisma.parameter.findMany is re-read.
    clearAliasCache();
    // Reset the parameter.findMany mock to the empty-array default
    // (vi.clearAllMocks above also clears the mockResolvedValue setup).
    mockPrisma.parameter.findMany.mockResolvedValue([]);

    // Default: authenticated viewer.
    mockIsAuthError.mockReturnValue(false);
    mockRequireAuth.mockResolvedValue({
      session: {
        user: { id: "u-1", email: "a@b.com", name: "Viewer", role: "VIEWER", image: null },
        expires: new Date(Date.now() + 86400000).toISOString(),
      },
    });

    // Default: caller has one identity row.
    mockResolveCallerIdentityIds.mockResolvedValue({
      ok: true,
      identityIds: ["identity-A"],
    });

    // Default: empty cascade.
    mockPrisma.behaviorTarget.findMany.mockResolvedValue([]);

    const mod = await import(
      "../../app/api/callers/[callerId]/effective-behavior-targets/route"
    );
    GET = mod.GET;
  });

  it("returns 200 + ok:true with the cascade array when playbookId is present", async () => {
    // SYSTEM only — happy path with one parameter.
    mockPrisma.behaviorTarget.findMany.mockImplementation(async (args: Record<string, unknown>) => {
      const where = (args?.where ?? {}) as Record<string, unknown>;
      if (where.scope === "SYSTEM") {
        return [{ parameterId: "BEH-WARMTH", targetValue: 0.5 }];
      }
      return [];
    });

    const res = await GET(makeRequest(PLAYBOOK_ID), { params: makeParams() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.callerId).toBe(GOLDEN_CALLER_ID);
    expect(data.playbookId).toBe(PLAYBOOK_ID);
    expect(Array.isArray(data.parameters)).toBe(true);
    expect(data.parameters).toHaveLength(1);
    expect(data.parameters[0].parameterId).toBe("BEH-WARMTH");
    expect(data.parameters[0].sourceScope).toBe("SYSTEM");
  });

  it("returns 400 when playbookId is missing", async () => {
    const res = await GET(makeRequest(null), { params: makeParams() });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(String(data.error)).toContain("playbookId");
  });

  it("returns the auth helper's error response when the caller is unauthenticated", async () => {
    // Simulate `requireAuth` returning an auth-error sentinel.
    const fakeAuthErrorResponse = new Response(
      JSON.stringify({ ok: false, error: "Unauthorized" }),
      { status: 401 },
    );
    mockRequireAuth.mockResolvedValue({ error: fakeAuthErrorResponse });
    mockIsAuthError.mockReturnValue(true);

    const res = await GET(makeRequest(PLAYBOOK_ID), { params: makeParams() });
    expect(res).toBe(fakeAuthErrorResponse);
    expect(res.status).toBe(401);
  });

  it("end-to-end: surfaces a CALLER-scope override row at the parameter's effectiveValue", async () => {
    // PR-2 acceptance criterion: with a BehaviorTarget(scope=CALLER,
    // parameterId=BEH-ABSTRACT-OK, targetValue=0.34) row, endpoint returns
    // 0.34 for that param.
    mockPrisma.behaviorTarget.findMany.mockImplementation(async (args: Record<string, unknown>) => {
      const where = (args?.where ?? {}) as Record<string, unknown>;
      const scope = where.scope as string | undefined;
      if (scope === "SYSTEM") {
        return [{ parameterId: "BEH-ABSTRACT-OK", targetValue: 0.5 }];
      }
      if (scope === "PLAYBOOK") {
        return [{ parameterId: "BEH-ABSTRACT-OK", targetValue: 0.6 }];
      }
      if (scope === "CALLER") {
        return [{ parameterId: "BEH-ABSTRACT-OK", targetValue: 0.34 }];
      }
      return [];
    });

    const res = await GET(makeRequest(PLAYBOOK_ID), { params: makeParams() });
    expect(res.status).toBe(200);
    const data = await res.json();
    const row = data.parameters.find(
      (p: { parameterId: string }) => p.parameterId === "BEH-ABSTRACT-OK",
    );
    expect(row).toBeDefined();
    expect(row.effectiveValue).toBe(0.34);
    expect(row.sourceScope).toBe("CALLER");
    expect(row.systemValue).toBe(0.5);
    expect(row.playbookValue).toBe(0.6);
    expect(row.callerValue).toBe(0.34);
  });
});
