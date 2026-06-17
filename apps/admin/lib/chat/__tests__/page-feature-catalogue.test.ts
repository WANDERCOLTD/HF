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

  it("stays under ~800-token budget (3200 chars proxy) for every registered page", () => {
    // #810 raised the cap from ~500 tokens (2000 chars) to ~700 tokens (2800
    // chars). The Design tab now exports 5 named `sections` (Progress Signals,
    // Tolerances, etc.) so the AI can answer section-level questions, which
    // costs ~120 extra tokens per render. Cheap given DATA-mode runs Sonnet
    // 4.5 — the grounding wins are worth more than the bytes.
    //
    // 2026-06-17 (#1572 / #1349): Course detail gained the Skills Framework
    // beta tab and Voice was extracted from Settings to its own first-class
    // tab. Combined cost ≈ +280 chars (~70 extra tokens) on the
    // /x/courses/abc-123 catalogue. Budget bumped from 2800 → 3200 chars
    // (~700 → ~800 tokens). Still cheap on DATA-mode Sonnet 4.5.
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
        `${route} catalogue exceeded 3200-char budget (got ${out.length})`,
      ).toBeLessThanOrEqual(3200);
    }
  });
});
