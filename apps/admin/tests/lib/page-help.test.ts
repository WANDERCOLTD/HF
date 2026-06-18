import { describe, it, expect } from "vitest";
import {
  PAGE_HELP_REGISTRY,
  getPageHelp,
  canSeeOperatorOnly,
} from "@/lib/help/page-help";

describe("page-help registry", () => {
  describe("getPageHelp — route matching", () => {
    it("returns the wizard entry for exact pathname", () => {
      const entry = getPageHelp("/x/get-started-v5");
      expect(entry).toBeDefined();
      expect(entry?.title).toBe("Build Course");
      expect(entry?.tourId).toBe("educator-tour");
    });

    it("returns the Courses index entry for exact pathname", () => {
      const entry = getPageHelp("/x/courses");
      expect(entry).toBeDefined();
      expect(entry?.title).toBe("Courses");
    });

    it("returns the Course detail entry for parameterised pathname", () => {
      const entry = getPageHelp("/x/courses/abc-123");
      expect(entry).toBeDefined();
      expect(entry?.title).toBe("Course detail");
      const labels = entry?.tabs?.map((t) => t.label);
      // Single source of truth — the literal labels array. Adding a new
      // tab requires a single edit here. Hardcoded count was retired
      // because it drifted twice in 24h (#1572 added Skills; PR #1852
      // added Teaching/Scoring/Modules — both required a separate edit
      // to bump the count next to the array).
      // P5 (#1850): "Design" removed — every lens is now reachable
      // from Journey / Teaching / Scoring / Voice / Modules.
      expect(labels).toEqual([
        "Teaching",
        "Scoring",
        "Modules",
        "Content",
        "Curriculum",
        "Learners",
        "Proof Points",
        "Goals",
        "Skills",
        "Voice",
        "Settings",
      ]);
      expect(entry?.tabs).toHaveLength(labels?.length ?? 0);
    });

    it("does NOT return Course detail for /x/courses/new (non-detail route)", () => {
      const entry = getPageHelp("/x/courses/new");
      expect(entry?.title).not.toBe("Course detail");
    });

    it("does NOT return Course detail for /x/courses/create or /x/courses/v3", () => {
      expect(getPageHelp("/x/courses/create")?.title).not.toBe("Course detail");
      expect(getPageHelp("/x/courses/v3")?.title).not.toBe("Course detail");
    });

    it("returns the Learner detail entry for parameterised pathname", () => {
      const entry = getPageHelp("/x/callers/xyz-789");
      expect(entry).toBeDefined();
      expect(entry?.title).toBe("Learner detail");
      const ids = entry?.tabs?.map((t) => t.id);
      // Single source of truth — the literal ids array. Adding/removing
      // a tab requires a single edit here (the count is derived).
      expect(ids).toEqual([
        "overview-v2",
        "calls-prompts",
        "tune",
        "progress-v2",
        "attainment",
        "adaptations",
        "uplift-v2",
        "session-flow",
        "how",
        "ai-call",
      ]);
      expect(entry?.tabs).toHaveLength(ids?.length ?? 0);
    });

    it("returns the Learners index entry for exact pathname", () => {
      const entry = getPageHelp("/x/callers");
      expect(entry?.title).toBe("Learners");
    });

    it("returns undefined for unknown pages", () => {
      expect(getPageHelp("/x/unknown-page")).toBeUndefined();
      expect(getPageHelp("/x/specs")).toBeUndefined();
      expect(getPageHelp("/")).toBeUndefined();
    });
  });

  describe("Course detail chord mapping", () => {
    it("uses T for Settings and marks it requiresOperator", () => {
      const entry = getPageHelp("/x/courses/abc-123");
      const settings = entry?.chords?.find((c) => c.callbackId === "tab:settings");
      expect(settings?.keys).toBe("T");
      expect(settings?.requiresOperator).toBe(true);
    });

    it("uses O for Goals (gOals — G is a chord prefix)", () => {
      const entry = getPageHelp("/x/courses/abc-123");
      const goals = entry?.chords?.find((c) => c.callbackId === "tab:goals");
      expect(goals?.keys).toBe("O");
    });

    it("uses U for Curriculum (cUrriculum — C collides with Content)", () => {
      const entry = getPageHelp("/x/courses/abc-123");
      const curr = entry?.chords?.find((c) => c.callbackId === "tab:curriculum");
      expect(curr?.keys).toBe("U");
    });

    it("never assigns H or G as chord keys (those are prefixes)", () => {
      const entry = getPageHelp("/x/courses/abc-123");
      const keys = entry?.chords?.map((c) => c.keys) ?? [];
      expect(keys).not.toContain("H");
      expect(keys).not.toContain("G");
    });
  });

  describe("Learner detail chord mapping", () => {
    it("uses R for Profile (pRofile — P is Progress)", () => {
      const entry = getPageHelp("/x/callers/xyz-789");
      const how = entry?.chords?.find((c) => c.callbackId === "tab:how");
      expect(how?.keys).toBe("R");
    });

    it("uses P for Progress (canonical first letter)", () => {
      const entry = getPageHelp("/x/callers/xyz-789");
      const progress = entry?.chords?.find((c) => c.callbackId === "tab:progress-v2");
      expect(progress?.keys).toBe("P");
    });

    it("uses A for Call (cAll)", () => {
      const entry = getPageHelp("/x/callers/xyz-789");
      const call = entry?.chords?.find((c) => c.callbackId === "tab:ai-call");
      expect(call?.keys).toBe("A");
    });

    it("uses S for Session Flow", () => {
      const entry = getPageHelp("/x/callers/xyz-789");
      const sf = entry?.chords?.find((c) => c.callbackId === "tab:session-flow");
      expect(sf?.keys).toBe("S");
    });

    it("never assigns H or G as chord keys (those are prefixes)", () => {
      const entry = getPageHelp("/x/callers/xyz-789");
      const keys = entry?.chords?.map((c) => c.keys) ?? [];
      expect(keys).not.toContain("H");
      expect(keys).not.toContain("G");
    });
  });

  describe("canSeeOperatorOnly", () => {
    it("allows OPERATOR, EDUCATOR, ADMIN, SUPERADMIN", () => {
      expect(canSeeOperatorOnly("OPERATOR")).toBe(true);
      expect(canSeeOperatorOnly("EDUCATOR")).toBe(true);
      expect(canSeeOperatorOnly("ADMIN")).toBe(true);
      expect(canSeeOperatorOnly("SUPERADMIN")).toBe(true);
    });

    it("blocks VIEWER, STUDENT, TESTER, DEMO, and unknown roles", () => {
      expect(canSeeOperatorOnly("VIEWER")).toBe(false);
      expect(canSeeOperatorOnly("STUDENT")).toBe(false);
      expect(canSeeOperatorOnly("TESTER")).toBe(false);
      expect(canSeeOperatorOnly("DEMO")).toBe(false);
      expect(canSeeOperatorOnly(undefined)).toBe(false);
      expect(canSeeOperatorOnly(null)).toBe(false);
      expect(canSeeOperatorOnly("")).toBe(false);
    });
  });

  /**
   * #810 freshness guard — retired in P5 (#1850).
   *
   * The freshness guard parsed `CourseDesignTab.tsx` for `<CollapsibleCard>`
   * titles and asserted each had a matching `sections[]` entry in
   * PAGE_HELP_REGISTRY → tabs[design]. The Design tab + the file it parsed
   * are now gone. The pattern (parse source for named sections, assert each
   * is registered) can be reapplied to a future tabbed page that grows
   * named sections — copy the parse block, point `sourceFile` at the new
   * tab component, and add the registry assertion. The retirement of this
   * block is part of the same PR that removed the Design tab.
   */
  describe("P5 (#1850) — Design tab retirement", () => {
    it("Design tab no longer appears in the Course detail registry", () => {
      const entry = getPageHelp("/x/courses/abc-123");
      const designTab = entry?.tabs?.find((t) => t.id === "design");
      expect(designTab).toBeUndefined();
    });

    it("Design chord is no longer registered (no D → tab:design binding)", () => {
      const entry = getPageHelp("/x/courses/abc-123");
      const designChord = entry?.chords?.find(
        (c) => c.callbackId === "tab:design",
      );
      expect(designChord).toBeUndefined();
    });
  });

  describe("registry invariants", () => {
    it("every chord key is a single uppercase letter A–Z", () => {
      for (const entry of PAGE_HELP_REGISTRY) {
        for (const chord of entry.chords ?? []) {
          expect(chord.keys).toMatch(/^[A-Z]$/);
        }
      }
    });

    it("no two chords on the same page share the same key", () => {
      for (const entry of PAGE_HELP_REGISTRY) {
        const keys = (entry.chords ?? []).map((c) => c.keys);
        expect(new Set(keys).size).toBe(keys.length);
      }
    });

    it("every tab id is unique within a page", () => {
      for (const entry of PAGE_HELP_REGISTRY) {
        const ids = (entry.tabs ?? []).map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });

    it("every navigate chord has an href and every callback chord has a callbackId", () => {
      for (const entry of PAGE_HELP_REGISTRY) {
        for (const chord of entry.chords ?? []) {
          if (chord.action === "navigate") {
            expect(chord.href).toBeTruthy();
          } else if (chord.action === "callback") {
            expect(chord.callbackId).toBeTruthy();
          }
        }
      }
    });
  });
});
