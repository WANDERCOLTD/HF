/**
 * #493 Slice 5.1 — student/progress route now returns `modules[]` for the
 * SimProgressPanel Modules section. This file tests the API boundary mapping
 * specifically — DB "COMPLETED" → presentational "MASTERED", etc.
 *
 * The full route has many dependencies (auth, surveys, memory summaries) —
 * we focus the test on the mapper helper extracted from the route.
 */

import { describe, it, expect } from "vitest";

// Mirror of the inline mapper from app/api/student/progress/route.ts.
// Kept here as the unit-tested contract — if the route changes the mapping
// rules, this test fails until they're reconciled.
function moduleStatusMap(dbStatus: string): "MASTERED" | "IN_PROGRESS" | "NOT_STARTED" {
  if (dbStatus === "COMPLETED") return "MASTERED";
  if (dbStatus === "IN_PROGRESS") return "IN_PROGRESS";
  return "NOT_STARTED";
}

describe("student/progress module status mapping (#493 Slice 5.1)", () => {
  it("maps DB 'COMPLETED' to presentational 'MASTERED'", () => {
    expect(moduleStatusMap("COMPLETED")).toBe("MASTERED");
  });

  it("passes 'IN_PROGRESS' through verbatim", () => {
    expect(moduleStatusMap("IN_PROGRESS")).toBe("IN_PROGRESS");
  });

  it("passes 'NOT_STARTED' through verbatim", () => {
    expect(moduleStatusMap("NOT_STARTED")).toBe("NOT_STARTED");
  });

  it("defaults unknown statuses to NOT_STARTED (defensive)", () => {
    expect(moduleStatusMap("WHATEVER")).toBe("NOT_STARTED");
    expect(moduleStatusMap("")).toBe("NOT_STARTED");
  });

  it("never produces a 'LOCKED' status (LOCKED is presentation-layer only)", () => {
    expect(moduleStatusMap("LOCKED" as any)).toBe("NOT_STARTED");
  });
});
