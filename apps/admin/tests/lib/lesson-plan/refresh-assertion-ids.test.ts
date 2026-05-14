/**
 * Tests for lesson plan assertion refresh and module-aware distribution.
 *
 * Tests the pure logic in distributeAssertionsByModule() — no DB required.
 */

import { describe, it, expect } from "vitest";
import { distributeAssertionsByModule } from "@/lib/lesson-plan/refresh-assertion-ids";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<{
  session: number;
  type: string;
  moduleId: string | null;
  learningOutcomeRefs: string[];
  assertionIds: string[];
}> = {}): any {
  return {
    session: 1,
    type: "introduce",
    moduleId: null,
    moduleLabel: "",
    label: "Test Session",
    assertionIds: undefined,
    learningOutcomeRefs: undefined,
    ...overrides,
  };
}

function makeAssertion(id: string, loRef: string | null = null): {
  id: string;
  learningOutcomeRef: string | null;
  learningObjectiveId: string | null;
  topicSlug: string | null;
  chapter: string | null;
} {
  return {
    id,
    learningOutcomeRef: loRef,
    learningObjectiveId: null,
    topicSlug: null,
    chapter: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("distributeAssertionsByModule", () => {
  it("distributes assertions by learningOutcomeRefs match", () => {
    const entries = [
      makeEntry({ session: 1, type: "introduce", learningOutcomeRefs: ["LO1", "LO2"] }),
      makeEntry({ session: 2, type: "deepen", learningOutcomeRefs: ["LO3"] }),
    ];
    const assertions = [
      makeAssertion("a1", "LO1"),
      makeAssertion("a2", "LO2"),
      makeAssertion("a3", "LO1"),
      makeAssertion("a4", "LO3"),
      makeAssertion("a5", "LO3"),
    ];

    const result = distributeAssertionsByModule(entries, assertions, "curr-1");

    expect(entries[0].assertionIds).toEqual(["a1", "a2", "a3"]);
    expect(entries[1].assertionIds).toEqual(["a4", "a5"]);
    expect(result.refilled).toBe(2);
    expect(result.orphaned).toBe(0);
  });

  it("skips structural sessions", () => {
    const entries = [
      makeEntry({ session: 1, type: "pre_survey" }),
      makeEntry({ session: 2, type: "introduce", learningOutcomeRefs: ["LO1"] }),
      makeEntry({ session: 3, type: "offboarding" }),
    ];
    const assertions = [makeAssertion("a1", "LO1")];

    distributeAssertionsByModule(entries, assertions, "curr-1");

    expect(entries[0].assertionIds).toBeUndefined();
    expect(entries[1].assertionIds).toEqual(["a1"]);
    expect(entries[2].assertionIds).toBeUndefined();
  });

  it("assessment inherits assertions from prior teaching sessions", () => {
    const entries = [
      makeEntry({ session: 1, type: "introduce", learningOutcomeRefs: ["LO1"], assertionIds: ["a1", "a2"] }),
      makeEntry({ session: 2, type: "deepen", learningOutcomeRefs: ["LO2"], assertionIds: ["a3"] }),
      makeEntry({ session: 3, type: "assess" }),
    ];
    const assertions = [
      makeAssertion("a1", "LO1"),
      makeAssertion("a2", "LO1"),
      makeAssertion("a3", "LO2"),
    ];

    const result = distributeAssertionsByModule(entries, assertions, "curr-1");

    // Assess should get all prior session assertions
    expect(entries[2].assertionIds).toEqual(["a1", "a2", "a3"]);
    expect(result.refilled).toBe(1);
  });

  it("consolidate inherits assertions from prior teaching sessions", () => {
    const entries = [
      makeEntry({ session: 1, type: "introduce", assertionIds: ["a1"] }),
      makeEntry({ session: 2, type: "consolidate" }),
    ];

    distributeAssertionsByModule(entries, [], "curr-1");

    expect(entries[1].assertionIds).toEqual(["a1"]);
  });

  it("round-robins unmatched assertions to empty entries", () => {
    const entries = [
      makeEntry({ session: 1, type: "introduce" }),
      makeEntry({ session: 2, type: "deepen" }),
    ];
    // No LO refs on entries, no LO refs on assertions → round-robin fallback
    const assertions = [
      makeAssertion("a1"),
      makeAssertion("a2"),
      makeAssertion("a3"),
    ];

    distributeAssertionsByModule(entries, assertions, "curr-1");

    expect(entries[0].assertionIds).toEqual(["a1", "a3"]);
    expect(entries[1].assertionIds).toEqual(["a2"]);
  });

  it("does not overwrite entries that already have assertionIds", () => {
    const entries = [
      makeEntry({ session: 1, type: "introduce", assertionIds: ["existing-1"], learningOutcomeRefs: ["LO1"] }),
      makeEntry({ session: 2, type: "deepen", learningOutcomeRefs: ["LO2"] }),
    ];
    const assertions = [
      makeAssertion("a1", "LO1"),
      makeAssertion("a2", "LO2"),
    ];

    distributeAssertionsByModule(entries, assertions, "curr-1");

    // First entry untouched — it already had assertionIds
    expect(entries[0].assertionIds).toEqual(["existing-1"]);
    // Second entry gets its LO match
    expect(entries[1].assertionIds).toEqual(["a2"]);
  });

  it("returns orphaned count when no assertions available", () => {
    const entries = [
      makeEntry({ session: 1, type: "introduce" }),
    ];

    const result = distributeAssertionsByModule(entries, [], "curr-1");

    expect(result.orphaned).toBe(1);
    expect(result.refilled).toBe(0);
  });

  it("handles partial LO ref matching (substring match)", () => {
    const entries = [
      makeEntry({ session: 1, type: "introduce", learningOutcomeRefs: ["LO1"] }),
    ];
    const assertions = [
      makeAssertion("a1", "R04-LO1-AC2.3"),  // contains "LO1"
      makeAssertion("a2", "R04-LO2-AC1.1"),  // does not contain "LO1"
    ];

    distributeAssertionsByModule(entries, assertions, "curr-1");

    expect(entries[0].assertionIds).toEqual(["a1"]);
  });

  it("does not double-assign assertions across entries", () => {
    const entries = [
      makeEntry({ session: 1, type: "introduce", learningOutcomeRefs: ["LO1"] }),
      makeEntry({ session: 2, type: "deepen", learningOutcomeRefs: ["LO1"] }),
    ];
    const assertions = [
      makeAssertion("a1", "LO1"),
      makeAssertion("a2", "LO1"),
    ];

    distributeAssertionsByModule(entries, assertions, "curr-1");

    // First entry claims both because it matches first
    expect(entries[0].assertionIds).toEqual(["a1", "a2"]);
    // Second entry is empty — assertions already assigned
    // It will be caught by the round-robin pass but no unassigned remain
    expect(entries[1].assertionIds?.length || 0).toBe(0);
  });

  it("sets assertionCount alongside assertionIds", () => {
    const entries = [
      makeEntry({ session: 1, type: "introduce", learningOutcomeRefs: ["LO1"] }),
    ];
    const assertions = [
      makeAssertion("a1", "LO1"),
      makeAssertion("a2", "LO1"),
      makeAssertion("a3", "LO1"),
    ];

    distributeAssertionsByModule(entries, assertions, "curr-1");

    expect(entries[0].assertionCount).toBe(3);
  });
});
