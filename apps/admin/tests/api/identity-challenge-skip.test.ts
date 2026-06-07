/**
 * Tests for POST /api/identity/challenge-skip — admin escape hatch
 * that marks a caller's most-recent unverified
 * CallerIdentityChallenge as verified without requiring the PIN.
 *
 * Security properties covered:
 *   - STUDENT / VIEWER refused 401 (requireAuth("OPERATOR") gate)
 *   - OPERATOR / EDUCATOR / ADMIN / SUPERADMIN allowed
 *   - Body validation (missing/invalid callerId → 400)
 *   - No active challenge → 200 { noActiveChallenge: true } (admin
 *     should request a resend first)
 *   - Audit breadcrumb fires (console.warn) so the action is
 *     traceable in logs
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("@/lib/permissions");

const mockChallengeFindFirst = vi.fn();
const mockChallengeUpdate = vi.fn();
const mockRequireAuth = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callerIdentityChallenge: {
      findFirst: (...args: unknown[]) => mockChallengeFindFirst(...args),
      update: (...args: unknown[]) => mockChallengeUpdate(...args),
    },
  },
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (v: unknown): v is { error: unknown } =>
    Boolean(v && typeof v === "object" && "error" in (v as Record<string, unknown>)),
}));

function makeAuth(role: string, userId = "user-1") {
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
  const mod = await import("@/app/api/identity/challenge-skip/route");
  const req = new Request("http://test/api/identity/challenge-skip", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await mod.POST(req);
  const json = await res.json();
  return { status: res.status, json };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/identity/challenge-skip", () => {
  describe("RBAC — OPERATOR+ only", () => {
    for (const role of ["OPERATOR", "EDUCATOR", "ADMIN", "SUPERADMIN"] as const) {
      it(`allows ${role} session to skip the challenge`, async () => {
        mockRequireAuth.mockResolvedValue(makeAuth(role));
        mockChallengeFindFirst.mockResolvedValue({ id: "chal-1" });
        mockChallengeUpdate.mockResolvedValue({ id: "chal-1" });

        const { status, json } = await callPost({ callerId: "c-1" });

        expect(status).toBe(200);
        expect(json).toEqual({ ok: true, challengeId: "chal-1" });
        expect(mockChallengeUpdate).toHaveBeenCalledWith({
          where: { id: "chal-1" },
          data: { verifiedAt: expect.any(Date) },
        });
      });
    }

    it("refuses STUDENT session — requireAuth returns auth error", async () => {
      mockRequireAuth.mockResolvedValue(makeAuthError(401));
      const { status } = await callPost({ callerId: "c-1" });
      expect(status).toBe(401);
      expect(mockChallengeFindFirst).not.toHaveBeenCalled();
    });
  });

  describe("Body validation", () => {
    it("400 when callerId is missing", async () => {
      mockRequireAuth.mockResolvedValue(makeAuth("OPERATOR"));
      const { status, json } = await callPost({});
      expect(status).toBe(400);
      expect(json.error).toMatch(/invalid/i);
    });

    it("400 when callerId is empty string", async () => {
      mockRequireAuth.mockResolvedValue(makeAuth("OPERATOR"));
      const { status } = await callPost({ callerId: "" });
      expect(status).toBe(400);
    });

    it("400 on unknown extra fields (zod strict)", async () => {
      mockRequireAuth.mockResolvedValue(makeAuth("OPERATOR"));
      const { status } = await callPost({ callerId: "c-1", pin: "123456" });
      expect(status).toBe(400);
    });
  });

  describe("No active challenge", () => {
    it("returns noActiveChallenge:true when there's no unverified challenge", async () => {
      mockRequireAuth.mockResolvedValue(makeAuth("ADMIN"));
      mockChallengeFindFirst.mockResolvedValue(null);

      const { status, json } = await callPost({ callerId: "c-1" });

      expect(status).toBe(200);
      expect(json).toEqual({ ok: false, noActiveChallenge: true });
      expect(mockChallengeUpdate).not.toHaveBeenCalled();
    });
  });

  describe("Audit", () => {
    it("emits a [identity/skip] console.warn breadcrumb on success", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockRequireAuth.mockResolvedValue(makeAuth("OPERATOR", "admin-42"));
      mockChallengeFindFirst.mockResolvedValue({ id: "chal-1" });
      mockChallengeUpdate.mockResolvedValue({ id: "chal-1" });

      await callPost({ callerId: "victim-1" });

      const call = warn.mock.calls.find(([msg]) =>
        typeof msg === "string" && msg.includes("[identity/skip]"),
      );
      expect(call).toBeDefined();
      expect(String(call?.[0])).toContain("admin-42");
      expect(String(call?.[0])).toContain("OPERATOR");
      expect(String(call?.[0])).toContain("victim-1");
      warn.mockRestore();
    });
  });
});
