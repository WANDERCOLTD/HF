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
    // Source of truth: lib/help/page-help.ts → Learner detail entry. The
    // older labels {How, What, Artifacts, AI Call} were renamed/merged
    // into {Profile, Call} (ids `how`, `ai-call`); What + Artifacts were
    // removed. Keep this list in step with the registry's `label` fields.
    for (const label of [
      "Overview",
      "Calls",
      "Tune",
      "Progress",
      "Uplift",
      "Session Flow",
      "Profile",
      "Call",
    ]) {
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

  // Cap raised stepwise as tabs accrue:
  //   #810   2000 →  2800  (Design sections)
  //   #1859  2800 →  3200  (Skills + Voice extract)
  //   #1852  3200 →  3700  (Teaching + Scoring + Modules — 3 new tabs)
  // Per-tab cost averages ~80 chars. The cap is a runaway-growth tripwire,
  // not a hard limit — DATA-mode runs Sonnet 4.5 where 100 extra tokens
  // is cheap. Bump when a real tab is added; investigate when one isn't.
  const BUDGET_CHARS = 3700;
  it(`stays under the ${BUDGET_CHARS}-char budget for every registered page`, () => {
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
        `${route} catalogue exceeded ${BUDGET_CHARS}-char budget (got ${out.length})`,
      ).toBeLessThanOrEqual(BUDGET_CHARS);
    }
  });
});
