import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
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

    it("returns the Course detail entry for parameterised pathname with 7 tabs", () => {
      const entry = getPageHelp("/x/courses/abc-123");
      expect(entry).toBeDefined();
      expect(entry?.title).toBe("Course detail");
      expect(entry?.tabs).toHaveLength(7);
      const labels = entry?.tabs?.map((t) => t.label);
      expect(labels).toEqual([
        "Content",
        "Design",
        "Curriculum",
        "Learners",
        "Proof Points",
        "Goals",
        "Settings",
      ]);
    });

    it("does NOT return Course detail for /x/courses/new (non-detail route)", () => {
      const entry = getPageHelp("/x/courses/new");
      expect(entry?.title).not.toBe("Course detail");
    });

    it("does NOT return Course detail for /x/courses/create or /x/courses/v3", () => {
      expect(getPageHelp("/x/courses/create")?.title).not.toBe("Course detail");
      expect(getPageHelp("/x/courses/v3")?.title).not.toBe("Course detail");
    });

    it("returns the Learner detail entry for parameterised pathname with 8 tabs", () => {
      const entry = getPageHelp("/x/callers/xyz-789");
      expect(entry).toBeDefined();
      expect(entry?.title).toBe("Learner detail");
      expect(entry?.tabs).toHaveLength(8);
      const ids = entry?.tabs?.map((t) => t.id);
      expect(ids).toEqual([
        "overview-v2",
        "calls-prompts",
        "tune",
        "progress-v2",
        "uplift-v2",
        "session-flow",
        "how",
        "ai-call",
      ]);
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
   * #810 freshness guard.
   *
   * The Felt Progress regression (epic #808) shipped a new `<CollapsibleCard
   * title="Felt Progress">` on the Design tab across 5 PRs without anyone
   * updating PAGE_HELP_REGISTRY. The Help modal stayed silent; the DATA-mode
   * AI assistant answered "I don't see that section". This block parses the
   * source TSX for every `<CollapsibleCard title="X">` on the Design tab and
   * asserts each title is registered under `tabs.find(design).sections[]`.
   *
   * To extend to a new tabbed page: copy the parse block, point `sourceFile`
   * at the tab component, and add the registry assertion.
   */
  describe("freshness guard — Course detail Design tab (#810)", () => {
    const sourceFile = path.resolve(
      __dirname,
      "../../app/x/courses/[courseId]/CourseDesignTab.tsx",
    );
    const source = fs.readFileSync(sourceFile, "utf-8");
    const cardTitles = Array.from(
      source.matchAll(/<CollapsibleCard\s+title="([^"]+)"/g),
      (m) => m[1],
    );

    it("source parse finds at least one CollapsibleCard (sanity)", () => {
      expect(cardTitles.length).toBeGreaterThan(0);
    });

    it("every CollapsibleCard rendered on the Design tab has a registry entry", () => {
      const entry = getPageHelp("/x/courses/abc-123");
      const designTab = entry?.tabs?.find((t) => t.id === "design");
      expect(designTab, "Design tab missing from Course detail registry").toBeDefined();
      const registeredTitles = (designTab?.sections ?? []).map((s) => s.title);
      for (const title of cardTitles) {
        expect(
          registeredTitles,
          `CourseDesignTab.tsx renders <CollapsibleCard title="${title}"> but no matching entry exists in PAGE_HELP_REGISTRY → tabs[design].sections. Add it to apps/admin/lib/help/page-help.ts so the Help modal and AI assistant know about it.`,
        ).toContain(title);
      }
    });

    it("Design tab `about` mentions Progress Signals so the Help modal surfaces it without HelpOverlay changes", () => {
      const entry = getPageHelp("/x/courses/abc-123");
      const designTab = entry?.tabs?.find((t) => t.id === "design");
      expect(designTab?.about.toLowerCase()).toContain("progress signals");
    });

    it("the Progress Signals section explicitly exists in the registry", () => {
      const entry = getPageHelp("/x/courses/abc-123");
      const designTab = entry?.tabs?.find((t) => t.id === "design");
      const progressSignals = designTab?.sections?.find((s) => s.title === "Progress Signals");
      expect(progressSignals).toBeDefined();
      expect(progressSignals?.about.length).toBeGreaterThan(20);
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
