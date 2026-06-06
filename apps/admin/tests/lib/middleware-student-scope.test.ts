/**
 * Tests for middleware.ts::checkStudentCallerScope — the edge-runtime
 * path-segment guard added in A5 (audit follow-up to #977).
 *
 * Security property: a STUDENT session can only ever read its own LEARNER
 * caller's data via /api/callers/[callerId]/** and /api/caller-graph/[callerId]/**
 * path-segment routes. Supplying a foreign id returns 403 before the route
 * handler runs.
 */

import { describe, it, expect } from "vitest";
import { checkStudentCallerScope, type TokenClaims } from "@/middleware";

function claims(role: string | null, learnerCallerId: string | null = null): TokenClaims {
  return { role, learnerCallerId };
}

describe("middleware.checkStudentCallerScope", () => {
  describe("STUDENT role", () => {
    it("blocks a foreign callerId on /api/callers/[callerId]/...", () => {
      const result = checkStudentCallerScope(
        "/api/callers/foreign-id/learning-trajectory",
        claims("STUDENT", "own-id"),
      );
      expect(result.blocked).toBe(true);
    });

    it("allows the STUDENT's own callerId on /api/callers/[callerId]/...", () => {
      const result = checkStudentCallerScope(
        "/api/callers/own-id/snapshot",
        claims("STUDENT", "own-id"),
      );
      expect(result.blocked).toBe(false);
    });

    it("blocks /api/caller-graph/[callerId] with a foreign id", () => {
      const result = checkStudentCallerScope(
        "/api/caller-graph/foreign-id",
        claims("STUDENT", "own-id"),
      );
      expect(result.blocked).toBe(true);
    });

    it("blocks when STUDENT has no learnerCallerId claim (defence-in-depth)", () => {
      const result = checkStudentCallerScope(
        "/api/callers/any-id/snapshot",
        claims("STUDENT", null),
      );
      expect(result.blocked).toBe(true);
    });

    it("matches the bare path with no trailing segment", () => {
      const result = checkStudentCallerScope(
        "/api/callers/foreign-id",
        claims("STUDENT", "own-id"),
      );
      expect(result.blocked).toBe(true);
    });
  });

  describe("non-STUDENT roles pass through", () => {
    for (const role of ["OPERATOR", "ADMIN", "SUPERADMIN", "VIEWER", "TESTER", "EDUCATOR"]) {
      it(`${role} can read any callerId path`, () => {
        const result = checkStudentCallerScope(
          "/api/callers/any-foreign-id/snapshot",
          claims(role, null),
        );
        expect(result.blocked).toBe(false);
      });
    }
  });

  describe("paths outside the caller-scope matcher", () => {
    it("ignores /api/calls/[callId] (handled by per-route guard, follow-up)", () => {
      const result = checkStudentCallerScope(
        "/api/calls/some-call-id",
        claims("STUDENT", "own-id"),
      );
      expect(result.blocked).toBe(false);
    });

    it("ignores /api/callers (list endpoint, no segment)", () => {
      const result = checkStudentCallerScope(
        "/api/callers",
        claims("STUDENT", "own-id"),
      );
      expect(result.blocked).toBe(false);
    });

    it("ignores /api/pipeline/runs (query-param caller scope, follow-up)", () => {
      const result = checkStudentCallerScope(
        "/api/pipeline/runs?callerId=foreign-id",
        claims("STUDENT", "own-id"),
      );
      expect(result.blocked).toBe(false);
    });

    it("ignores unrelated routes", () => {
      const result = checkStudentCallerScope(
        "/api/health",
        claims("STUDENT", "own-id"),
      );
      expect(result.blocked).toBe(false);
    });
  });

  describe("null / unauthenticated claims", () => {
    it("passes through when claims are null (auth() will handle it)", () => {
      const result = checkStudentCallerScope(
        "/api/callers/foreign-id/snapshot",
        null,
      );
      expect(result.blocked).toBe(false);
    });

    it("passes through when role is null", () => {
      const result = checkStudentCallerScope(
        "/api/callers/foreign-id/snapshot",
        claims(null, null),
      );
      expect(result.blocked).toBe(false);
    });
  });
});
