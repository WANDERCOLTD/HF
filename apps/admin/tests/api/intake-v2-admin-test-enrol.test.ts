/**
 * Tests for POST /api/intake/v2/admin-test-enrol — admin escape hatch
 * on the V2 intake entry screen. Creates a synthetic Test/Admin
 * User+Caller for a classroom without issuing a PIN, without minting
 * a new session cookie (admin keeps theirs), and returns a redirect
 * to /x/sim/<callerId>.
 *
 * Security properties covered:
 *   - STUDENT / VIEWER refused 401 (requireAuth("OPERATOR") gate)
 *   - OPERATOR / EDUCATOR / ADMIN / SUPERADMIN allowed
 *   - Body validation (missing/empty classroomToken → 400; extra
 *     keys rejected by zod strict)
 *   - Invalid cohort token → 404
 *   - Expired cohort token → 410
 *   - Audit breadcrumb fires (console.warn) on success
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("@/lib/permissions");

const mockCohortFindUnique = vi.fn();
const mockTxUserCreate = vi.fn();
const mockTxCallerCreate = vi.fn();
const mockTxMembershipCreate = vi.fn();
const mockTransaction = vi.fn();
const mockEnrollInCohort = vi.fn();
const mockRequireAuth = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cohortGroup: {
      findUnique: (...args: unknown[]) => mockCohortFindUnique(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock("@/lib/enrollment", () => ({
  enrollCallerInCohortPlaybooks: (...args: unknown[]) =>
    mockEnrollInCohort(...args),
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (v: unknown): v is { error: unknown } =>
    Boolean(v && typeof v === "object" && "error" in (v as Record<string, unknown>)),
}));

function makeAuth(role: string, userId = "admin-1") {
  return {
    session: {
      expires: new Date(Date.now() + 86400000).toISOString(),
      user: { id: userId, email: "u@example.com", name: "U", image: null, role },
    },
  };
}

function makeAuthError(status: number) {
  return {
    error: new Response(JSON.stringify({ error: "Unauthorized" }), { status }),
  };
}

async function callPost(body: unknown) {
  const mod = await import("@/app/api/intake/v2/admin-test-enrol/route");
  const req = new Request("http://test/api/intake/v2/admin-test-enrol", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await mod.POST(req);
  const json = await res.json();
  return { status: res.status, json };
}

function wireHappyTransaction() {
  mockTxUserCreate.mockResolvedValue({ id: "user-new" });
  mockTxCallerCreate.mockResolvedValue({ id: "caller-new" });
  mockTxMembershipCreate.mockResolvedValue({});
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    return fn({
      user: { create: (...a: unknown[]) => mockTxUserCreate(...a) },
      caller: { create: (...a: unknown[]) => mockTxCallerCreate(...a) },
      callerCohortMembership: {
        create: (...a: unknown[]) => mockTxMembershipCreate(...a),
      },
    });
  });
  mockEnrollInCohort.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/intake/v2/admin-test-enrol", () => {
  describe("RBAC — OPERATOR+ only", () => {
    for (const role of ["OPERATOR", "EDUCATOR", "ADMIN", "SUPERADMIN"] as const) {
      it(`allows ${role} session to create a synthetic test caller`, async () => {
        mockRequireAuth.mockResolvedValue(makeAuth(role));
        mockCohortFindUnique.mockResolvedValue({
          id: "cohort-1",
          isActive: true,
          joinTokenExp: null,
          domainId: "dom-1",
          institutionId: "inst-1",
        });
        wireHappyTransaction();

        const { status, json } = await callPost({ classroomToken: "tok-1" });

        expect(status).toBe(200);
        expect(json.ok).toBe(true);
        expect(json.callerId).toBe("caller-new");
        expect(json.redirect).toBe("/x/sim/caller-new");
        expect(mockTxUserCreate).toHaveBeenCalledTimes(1);
        expect(mockTxCallerCreate).toHaveBeenCalledTimes(1);
        expect(mockTxMembershipCreate).toHaveBeenCalledTimes(1);
        expect(mockEnrollInCohort).toHaveBeenCalled();
      });
    }

    it("refuses STUDENT-equivalent (requireAuth returns auth error) — 401", async () => {
      mockRequireAuth.mockResolvedValue(makeAuthError(401));
      const { status } = await callPost({ classroomToken: "tok-1" });
      expect(status).toBe(401);
      expect(mockCohortFindUnique).not.toHaveBeenCalled();
    });
  });

  describe("Body validation", () => {
    it("400 when classroomToken is missing", async () => {
      mockRequireAuth.mockResolvedValue(makeAuth("OPERATOR"));
      const { status } = await callPost({});
      expect(status).toBe(400);
    });

    it("400 when classroomToken is empty", async () => {
      mockRequireAuth.mockResolvedValue(makeAuth("OPERATOR"));
      const { status } = await callPost({ classroomToken: "" });
      expect(status).toBe(400);
    });

    it("400 on extra unknown fields (zod strict)", async () => {
      mockRequireAuth.mockResolvedValue(makeAuth("OPERATOR"));
      const { status } = await callPost({
        classroomToken: "tok-1",
        adminMode: true,
      });
      expect(status).toBe(400);
    });
  });

  describe("Cohort token validation", () => {
    it("404 when the cohort doesn't exist", async () => {
      mockRequireAuth.mockResolvedValue(makeAuth("ADMIN"));
      mockCohortFindUnique.mockResolvedValue(null);
      const { status, json } = await callPost({ classroomToken: "ghost" });
      expect(status).toBe(404);
      expect(json.error).toMatch(/invalid/i);
    });

    it("404 when the cohort exists but is inactive", async () => {
      mockRequireAuth.mockResolvedValue(makeAuth("ADMIN"));
      mockCohortFindUnique.mockResolvedValue({
        id: "cohort-1",
        isActive: false,
        joinTokenExp: null,
        domainId: "dom-1",
        institutionId: "inst-1",
      });
      const { status } = await callPost({ classroomToken: "tok-1" });
      expect(status).toBe(404);
    });

    it("410 when the cohort's joinTokenExp has passed", async () => {
      mockRequireAuth.mockResolvedValue(makeAuth("ADMIN"));
      mockCohortFindUnique.mockResolvedValue({
        id: "cohort-1",
        isActive: true,
        joinTokenExp: new Date(Date.now() - 1000),
        domainId: "dom-1",
        institutionId: "inst-1",
      });
      const { status, json } = await callPost({ classroomToken: "tok-1" });
      expect(status).toBe(410);
      expect(json.error).toMatch(/expired/i);
    });
  });

  describe("Audit", () => {
    it("emits a [intake-v2/admin-test-enrol] console.warn breadcrumb with admin + caller info", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockRequireAuth.mockResolvedValue(makeAuth("OPERATOR", "admin-42"));
      mockCohortFindUnique.mockResolvedValue({
        id: "cohort-7",
        isActive: true,
        joinTokenExp: null,
        domainId: "dom-1",
        institutionId: "inst-1",
      });
      wireHappyTransaction();

      await callPost({ classroomToken: "tok-1" });

      const call = warn.mock.calls.find(([msg]) =>
        typeof msg === "string" && msg.includes("[intake-v2/admin-test-enrol]"),
      );
      expect(call).toBeDefined();
      expect(String(call?.[0])).toContain("admin-42");
      expect(String(call?.[0])).toContain("OPERATOR");
      expect(String(call?.[0])).toContain("caller-new");
      expect(String(call?.[0])).toContain("cohort-7");
      warn.mockRestore();
    });
  });

  describe("Identity shape", () => {
    it("synthetic email uses the non-routable .hf-admin.local domain", async () => {
      mockRequireAuth.mockResolvedValue(makeAuth("OPERATOR"));
      mockCohortFindUnique.mockResolvedValue({
        id: "cohort-1",
        isActive: true,
        joinTokenExp: null,
        domainId: "dom-1",
        institutionId: "inst-1",
      });
      wireHappyTransaction();

      await callPost({ classroomToken: "tok-1" });

      const userCreateArg = mockTxUserCreate.mock.calls[0][0];
      expect(userCreateArg.data.email).toMatch(/^test-admin-[0-9a-f]{8}@hf-admin\.local$/);
      expect(userCreateArg.data.role).toBe("STUDENT");
      expect(userCreateArg.data.name).toMatch(/^Test Admin-[0-9a-f]{8}$/);
    });
  });
});
