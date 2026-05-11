import { describe, it, expect } from "vitest";
import {
  filterLOsForAudience,
  parseAudience,
  projectLoForAudience,
  resolveLoDescription,
  type AudienceAwareLo,
} from "@/lib/curriculum/lo-audience";

function lo(overrides: Partial<AudienceAwareLo> = {}): AudienceAwareLo {
  return {
    id: "lo-1",
    ref: "LO1",
    description: "Original LO description",
    originalText: "Original LO description",
    sortOrder: 0,
    masteryThreshold: null,
    learnerVisible: true,
    performanceStatement: null,
    systemRole: "NONE",
    humanOverriddenAt: null,
    ...overrides,
  };
}

describe("parseAudience", () => {
  it("returns 'learner' for the literal string 'learner'", () => {
    expect(parseAudience("learner")).toBe("learner");
  });

  it("defaults to 'author' for null/undefined/empty/unknown", () => {
    expect(parseAudience(null)).toBe("author");
    expect(parseAudience(undefined)).toBe("author");
    expect(parseAudience("")).toBe("author");
    expect(parseAudience("admin")).toBe("author");
    expect(parseAudience("LEARNER")).toBe("author"); // case-sensitive
  });
});

describe("resolveLoDescription", () => {
  it("learner view uses performanceStatement when set", () => {
    const row = lo({ performanceStatement: "Speak for 90 seconds" });
    expect(resolveLoDescription(row, "learner")).toBe("Speak for 90 seconds");
  });

  it("learner view falls back to description when performanceStatement is null", () => {
    const row = lo({ performanceStatement: null, description: "fallback" });
    expect(resolveLoDescription(row, "learner")).toBe("fallback");
  });

  it("author view always returns description, even if performanceStatement is set", () => {
    const row = lo({ performanceStatement: "polished version", description: "raw" });
    expect(resolveLoDescription(row, "author")).toBe("raw");
  });
});

describe("filterLOsForAudience", () => {
  it("learner view drops learnerVisible=false rows", () => {
    const rows = [
      lo({ id: "a", learnerVisible: true }),
      lo({ id: "b", learnerVisible: false, systemRole: "ASSESSOR_RUBRIC" }),
      lo({ id: "c", learnerVisible: true }),
    ];
    const filtered = filterLOsForAudience(rows, "learner");
    expect(filtered.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("author view returns every row including hidden", () => {
    const rows = [
      lo({ id: "a", learnerVisible: true }),
      lo({ id: "b", learnerVisible: false }),
    ];
    expect(filterLOsForAudience(rows, "author")).toHaveLength(2);
  });
});

describe("projectLoForAudience", () => {
  it("learner view shape — minimal fields, performanceStatement projected into description", () => {
    const row = lo({
      ref: "LO9",
      description: "Explain what Lexical Resource assesses",
      performanceStatement: "Paraphrase any answer three ways",
      systemRole: "NONE",
      learnerVisible: true,
    });
    const projected = projectLoForAudience(row, "learner");

    expect(projected).toEqual({
      id: "lo-1",
      ref: "LO9",
      description: "Paraphrase any answer three ways",
      sortOrder: 0,
      masteryThreshold: null,
    });
    // Classifier columns NOT leaked to learner
    expect(projected).not.toHaveProperty("systemRole");
    expect(projected).not.toHaveProperty("learnerVisible");
    expect(projected).not.toHaveProperty("performanceStatement");
    expect(projected).not.toHaveProperty("humanOverriddenAt");
    expect(projected).not.toHaveProperty("originalText");
  });

  it("author view shape — full record with classifier columns", () => {
    const overriddenAt = new Date("2026-04-15T09:00:00Z");
    const row = lo({
      ref: "LO13",
      description: "Describe band descriptor structure",
      originalText: "Describe band descriptor structure",
      systemRole: "SCORE_EXPLAINER",
      learnerVisible: false,
      performanceStatement: null,
      humanOverriddenAt: overriddenAt,
    });
    const projected = projectLoForAudience(row, "author");

    expect(projected).toEqual({
      id: "lo-1",
      ref: "LO13",
      description: "Describe band descriptor structure",
      originalText: "Describe band descriptor structure",
      sortOrder: 0,
      masteryThreshold: null,
      learnerVisible: false,
      performanceStatement: null,
      systemRole: "SCORE_EXPLAINER",
      humanOverriddenAt: overriddenAt,
    });
  });

  it("learner view falls back to description when no performanceStatement", () => {
    const row = lo({ description: "Original wording", performanceStatement: null });
    const projected = projectLoForAudience(row, "learner") as { description: string };
    expect(projected.description).toBe("Original wording");
  });
});
