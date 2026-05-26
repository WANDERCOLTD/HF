import { describe, it, expect } from "vitest";
import { buildPageFeatureCatalogue } from "../page-feature-catalogue";

describe("buildPageFeatureCatalogue", () => {
  it("returns empty string for unknown route", () => {
    expect(buildPageFeatureCatalogue("/does-not-exist")).toBe("");
  });

  it("returns empty string when pathname is undefined", () => {
    expect(buildPageFeatureCatalogue(undefined)).toBe("");
  });

  it("returns empty string when pathname is empty", () => {
    expect(buildPageFeatureCatalogue("")).toBe("");
  });

  it("renders the page title + about for a known tabbed route", () => {
    const out = buildPageFeatureCatalogue("/x/courses/abc-123");
    expect(out).toContain("Course detail");
    expect(out).toContain("PAGE_HELP_REGISTRY");
  });

  it("lists every tab label registered for Course detail", () => {
    const out = buildPageFeatureCatalogue("/x/courses/abc-123");
    for (const label of ["Content", "Design", "Curriculum", "Learners", "Proof Points", "Goals", "Settings"]) {
      expect(out).toContain(label);
    }
  });

  it("lists every tab label registered for Learner detail", () => {
    const out = buildPageFeatureCatalogue("/x/callers/caller-xyz");
    for (const label of ["Overview", "Uplift", "Calls", "Tune", "How", "What", "Artifacts", "AI Call"]) {
      expect(out).toContain(label);
    }
  });

  it("renders an entry for the Courses index (no tabs)", () => {
    const out = buildPageFeatureCatalogue("/x/courses");
    expect(out).toContain("Courses");
    // No tabs registered for /x/courses — the Tabs section must NOT appear.
    expect(out).not.toContain("Tabs on this page");
  });

  it("flags operator-only tabs", () => {
    const out = buildPageFeatureCatalogue("/x/courses/abc-123");
    // Settings is operator-only on Course detail.
    expect(out).toMatch(/\*\*Settings\*\*.*operator-only/);
  });

  it("stays under ~500-token budget (2000 chars proxy) for every registered page", () => {
    const routes = [
      "/x/get-started-v5",
      "/x/courses",
      "/x/courses/abc-123",
      "/x/callers",
      "/x/callers/learner-xyz",
    ];
    for (const route of routes) {
      const out = buildPageFeatureCatalogue(route);
      expect(
        out.length,
        `${route} catalogue exceeded 2000-char budget (got ${out.length})`,
      ).toBeLessThanOrEqual(2000);
    }
  });
});
