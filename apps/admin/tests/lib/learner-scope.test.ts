/**
 * Tests for lib/learner-scope.ts — caller-scope resolver used by
 * /api/calls, /api/goals, /api/memories (issue #977).
 *
 * Security property: a STUDENT session can only ever read its own
 * LEARNER caller's data, regardless of what `?callerId=` they supply.
 * OPERATOR+ sessions retain admin-browsing behaviour.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";

vi.unmock("@/lib/learner-scope");

const mockCallerFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    caller: {
      findFirst: (...args: any[]) => mockCallerFindFirst(...args),
    },
  },
}));

function makeSession(role: string, userId = "user-1"): Session {
  return {
    expires: new Date(Date.now() + 86400000).toISOString(),
    user: {
      id: userId,
      email: "u@example.com",
      name: "U",
      image: null,
      role,
    },
  } as unknown as Session;
}

describe("lib/learner-scope", () => {
  let resolveCallerScopeForReading: typeof import("@/lib/learner-scope").resolveCallerScopeForReading;
  let isScopeError: typeof import("@/lib/learner-scope").isScopeError;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/lib/learner-scope");
    resolveCallerScopeForReading = mod.resolveCallerScopeForReading;
    isScopeError = mod.isScopeError;
  });

  describe("STUDENT role", () => {
    it("ignores the requested callerId and locks to own LEARNER caller", async () => {
      mockCallerFindFirst.mockResolvedValueOnce({ id: "own-caller" });

      const result = await resolveCallerScopeForReading(
        makeSession("STUDENT", "user-1"),
        "some-other-caller", // attacker-supplied
      );

      expect(isScopeError(result)).toBe(false);
      expect(result).toEqual({ scopedCallerId: "own-caller" });
      expect(mockCallerFindFirst).toHaveBeenCalledWith({
        where: { userId: "user-1", role: "LEARNER" },
        select: { id: true },
      });
    });

    it("returns own caller when no callerId is requested", async () => {
      mockCallerFindFirst.mockResolvedValueOnce({ id: "own-caller" });

      const result = await resolveCallerScopeForReading(
        makeSession("STUDENT"),
        null,
      );

      expect(result).toEqual({ scopedCallerId: "own-caller" });
    });

    it("returns 403 when STUDENT has no linked LEARNER caller", async () => {
      mockCallerFindFirst.mockResolvedValueOnce(null);

      const result = await resolveCallerScopeForReading(
        makeSession("STUDENT"),
        null,
      );

      expect(isScopeError(result)).toBe(true);
      if (isScopeError(result)) {
        expect(result.error.status).toBe(403);
        const body = await result.error.json();
        expect(body).toEqual({ ok: false, error: "No learner profile found" });
      }
    });
  });

  describe("non-STUDENT roles (admin passthrough)", () => {
    it("OPERATOR with requested callerId passes through unchanged", async () => {
      const result = await resolveCallerScopeForReading(
        makeSession("OPERATOR"),
        "any-caller",
      );

      expect(result).toEqual({ scopedCallerId: "any-caller" });
      expect(mockCallerFindFirst).not.toHaveBeenCalled();
    });

    it("OPERATOR with no callerId resolves to null (no filter)", async () => {
      const result = await resolveCallerScopeForReading(
        makeSession("OPERATOR"),
        null,
      );

      expect(result).toEqual({ scopedCallerId: null });
    });

    it("ADMIN passes through unchanged", async () => {
      const result = await resolveCallerScopeForReading(
        makeSession("ADMIN"),
        "x",
      );
      expect(result).toEqual({ scopedCallerId: "x" });
    });

    it("SUPERADMIN passes through unchanged", async () => {
      const result = await resolveCallerScopeForReading(
        makeSession("SUPERADMIN"),
        null,
      );
      expect(result).toEqual({ scopedCallerId: null });
    });

    it("VIEWER (legacy alias) passes through unchanged", async () => {
      const result = await resolveCallerScopeForReading(
        makeSession("VIEWER"),
        "any",
      );
      expect(result).toEqual({ scopedCallerId: "any" });
    });

    it("TESTER passes through unchanged", async () => {
      const result = await resolveCallerScopeForReading(
        makeSession("TESTER"),
        "any",
      );
      expect(result).toEqual({ scopedCallerId: "any" });
    });
  });
});
