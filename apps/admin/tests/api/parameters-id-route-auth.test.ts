/**
 * Tests for /api/parameters/[id] auth gates (#1947).
 *
 * Verifies the SUPERADMIN tightening on PUT + DELETE — the canonical-spec
 * write surface for `definition`, `interpretationHigh`, `interpretationLow`.
 * OPERATOR can still read via GET; only HF (SUPERADMIN) can mutate or
 * delete a parameter's HF-canonical content per epic #1946 IP boundary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("@/lib/permissions");

const mockParameterFindUnique = vi.fn();
const mockParameterUpdate = vi.fn();
const mockParameterDelete = vi.fn();
const mockRequireAuth = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    parameter: {
      findUnique: (...args: unknown[]) => mockParameterFindUnique(...args),
      update: (...args: unknown[]) => mockParameterUpdate(...args),
      delete: (...args: unknown[]) => mockParameterDelete(...args),
    },
  },
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (v: unknown): v is { error: unknown } =>
    Boolean(v && typeof v === "object" && "error" in (v as Record<string, unknown>)),
}));

function makeSession(role: string) {
  return {
    session: {
      expires: new Date(Date.now() + 86400000).toISOString(),
      user: {
        id: "user-1",
        email: "u@example.com",
        name: "U",
        image: null,
        role,
      },
    },
  };
}

function makeAuthError(status = 403) {
  return {
    error: new Response(JSON.stringify({ error: "forbidden" }), { status }),
  };
}

async function callGET(id: string) {
  const mod = await import("@/app/api/parameters/[id]/route");
  const req = new Request(`http://test/api/parameters/${id}`);
  const res = await mod.GET(req as any, { params: Promise.resolve({ id }) });
  return { status: res.status };
}

async function callPUT(id: string, body: unknown) {
  const mod = await import("@/app/api/parameters/[id]/route");
  const req = new Request(`http://test/api/parameters/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await mod.PUT(req as any, { params: Promise.resolve({ id }) });
  return { status: res.status };
}

async function callDELETE(id: string) {
  const mod = await import("@/app/api/parameters/[id]/route");
  const req = new Request(`http://test/api/parameters/${id}`, { method: "DELETE" });
  const res = await mod.DELETE(req as any, { params: Promise.resolve({ id }) });
  return { status: res.status };
}

describe("/api/parameters/[id] — #1947 IP-leak fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET (read — preserved at VIEWER)", () => {
    it("succeeds for VIEWER role", async () => {
      mockRequireAuth.mockResolvedValue(makeSession("VIEWER"));
      mockParameterFindUnique.mockResolvedValue({ id: "p-1", parameterId: "BEH-WARMTH" });

      const { status } = await callGET("p-1");

      expect(status).toBe(200);
      expect(mockRequireAuth).toHaveBeenCalledWith("VIEWER");
    });

    it("returns 404 when the parameter doesn't exist", async () => {
      mockRequireAuth.mockResolvedValue(makeSession("VIEWER"));
      mockParameterFindUnique.mockResolvedValue(null);

      const { status } = await callGET("ghost");
      expect(status).toBe(404);
    });
  });

  describe("PUT (canonical-spec write — SUPERADMIN only)", () => {
    it("calls requireAuth with SUPERADMIN (raised from OPERATOR)", async () => {
      mockRequireAuth.mockResolvedValue(makeSession("SUPERADMIN"));
      mockParameterUpdate.mockResolvedValue({ id: "p-1" });

      await callPUT("p-1", {
        name: "Warmth",
        definition: "Tutor's tonal warmth",
        interpretationHigh: "Markedly warm and personal in tone",
        interpretationLow: "Cool, formal, professional register",
      });

      expect(mockRequireAuth).toHaveBeenCalledWith("SUPERADMIN");
    });

    it("returns 403 for OPERATOR (the pre-fix leak)", async () => {
      // Simulate requireAuth("SUPERADMIN") rejecting an OPERATOR session
      // — the real helper returns isAuthError when role < SUPERADMIN.
      mockRequireAuth.mockResolvedValue(makeAuthError(403));

      const { status } = await callPUT("p-1", {
        definition: "Customer-overwritten definition",
      });

      expect(status).toBe(403);
      expect(mockParameterUpdate).not.toHaveBeenCalled();
    });

    it("returns 403 for ADMIN (above OPERATOR but still not HF)", async () => {
      mockRequireAuth.mockResolvedValue(makeAuthError(403));

      const { status } = await callPUT("p-1", {
        interpretationHigh: "Admin tried to overwrite IP",
      });

      expect(status).toBe(403);
      expect(mockParameterUpdate).not.toHaveBeenCalled();
    });

    it("succeeds for SUPERADMIN — writes the canonical fields", async () => {
      mockRequireAuth.mockResolvedValue(makeSession("SUPERADMIN"));
      mockParameterUpdate.mockResolvedValue({ id: "p-1", name: "Warmth" });

      const { status } = await callPUT("p-1", {
        name: "Warmth",
        domainGroup: "behavior-core",
        definition: "Tutor's tonal warmth",
        interpretationHigh: "Markedly warm and personal in tone",
        interpretationLow: "Cool, formal, professional register",
      });

      expect(status).toBe(200);
      expect(mockParameterUpdate).toHaveBeenCalledOnce();
      const updateArgs = mockParameterUpdate.mock.calls[0][0];
      expect(updateArgs.data.definition).toBe("Tutor's tonal warmth");
      expect(updateArgs.data.interpretationHigh).toBe(
        "Markedly warm and personal in tone",
      );
      expect(updateArgs.data.interpretationLow).toBe(
        "Cool, formal, professional register",
      );
    });
  });

  describe("DELETE (destructive IP action — SUPERADMIN only)", () => {
    it("calls requireAuth with SUPERADMIN (raised from OPERATOR)", async () => {
      mockRequireAuth.mockResolvedValue(makeSession("SUPERADMIN"));
      mockParameterDelete.mockResolvedValue({ id: "p-1" });

      await callDELETE("p-1");

      expect(mockRequireAuth).toHaveBeenCalledWith("SUPERADMIN");
    });

    it("returns 403 for OPERATOR (the pre-fix leak)", async () => {
      mockRequireAuth.mockResolvedValue(makeAuthError(403));

      const { status } = await callDELETE("p-1");

      expect(status).toBe(403);
      expect(mockParameterDelete).not.toHaveBeenCalled();
    });

    it("succeeds for SUPERADMIN", async () => {
      mockRequireAuth.mockResolvedValue(makeSession("SUPERADMIN"));
      mockParameterDelete.mockResolvedValue({ id: "p-1" });

      const { status } = await callDELETE("p-1");

      expect(status).toBe(200);
      expect(mockParameterDelete).toHaveBeenCalledOnce();
    });
  });
});
