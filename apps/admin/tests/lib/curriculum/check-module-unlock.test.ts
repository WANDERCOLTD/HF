/**
 * #1746 (epic #1700 Theme 5) — isModuleUnlocked role-aware gate.
 *
 * Pins:
 *   - OPERATOR+ always bypass
 *   - STUDENT blocked when prereqs unmet
 *   - String-form prereqs treated as minCompletions=1
 *   - Object-form prereqs honour custom minCompletions (count-based)
 *   - Continuous course → unlocked (gate doesn't apply)
 *   - Empty prereqs → unlocked
 *   - Missing prereqs surface in `missing[]` with module label
 */

import { describe, it, expect, vi } from "vitest";
import { isModuleUnlocked } from "@/lib/curriculum/check-module-unlock";
import type { AuthoredModule, PlaybookConfig } from "@/lib/types/json-fields";

function makeAuthored(
  id: string,
  prerequisites: AuthoredModule["prerequisites"] = [],
): AuthoredModule {
  return {
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    learnerSelectable: true,
    mode: "tutor",
    duration: "10 min",
    scoringFired: "All four",
    voiceBandReadout: false,
    sessionTerminal: false,
    frequency: "repeatable",
    outcomesPrimary: [],
    prerequisites,
  };
}

function makeConfig(modules: AuthoredModule[], structured = true): PlaybookConfig {
  return {
    modules,
    ...(structured ? { lessonPlanMode: "structured" } : {}),
  } as PlaybookConfig;
}

function makePrisma(
  rows: Array<{ slug: string; status: string; callCount?: number }>,
) {
  return {
    callerModuleProgress: {
      findMany: vi.fn(async () =>
        rows.map((r) => ({
          moduleId: `mod-${r.slug}`,
          status: r.status,
          callCount: r.callCount ?? (r.status === "COMPLETED" ? 1 : 0),
          module: { slug: r.slug },
        })),
      ),
    },
  };
}

describe("isModuleUnlocked", () => {
  describe("role bypass", () => {
    for (const role of ["OPERATOR", "EDUCATOR", "ADMIN", "SUPERADMIN"]) {
      it(`${role} → unlocked + reason="role-bypass" regardless of prereqs`, async () => {
        const mock = makePrisma([]);
        const result = await isModuleUnlocked(mock as never, {
          callerId: "caller-1",
          module: makeAuthored("mock", [
            { moduleId: "part1", minCompletions: 99 },
          ]),
          playbookConfig: makeConfig([
            makeAuthored("mock"),
            makeAuthored("part1"),
          ]),
          callerRole: role,
        });
        expect(result).toEqual({ unlocked: true, reason: "role-bypass" });
        // Role bypass short-circuits before any DB call.
        expect(mock.callerModuleProgress.findMany).not.toHaveBeenCalled();
      });
    }

    for (const role of ["STUDENT", "VIEWER", "TESTER", "SUPER_TESTER", "DEMO", null, undefined]) {
      it(`${role ?? "null"} → gate enforced (no bypass)`, async () => {
        const mock = makePrisma([]);
        const result = await isModuleUnlocked(mock as never, {
          callerId: "caller-1",
          module: makeAuthored("mock", [{ moduleId: "part1", minCompletions: 1 }]),
          playbookConfig: makeConfig([
            makeAuthored("mock"),
            makeAuthored("part1"),
          ]),
          callerRole: role,
        });
        expect(result.unlocked).toBe(false);
        expect(result.reason).toBe("prerequisites-unmet");
      });
    }
  });

  describe("continuous-course short-circuit", () => {
    it("returns unlocked when course is not structured", async () => {
      const mock = makePrisma([]);
      const result = await isModuleUnlocked(mock as never, {
        callerId: "caller-1",
        module: makeAuthored("mock", [{ moduleId: "part1", minCompletions: 99 }]),
        playbookConfig: makeConfig([], false),
        callerRole: "STUDENT",
      });
      expect(result).toEqual({ unlocked: true, reason: "continuous-course" });
      expect(mock.callerModuleProgress.findMany).not.toHaveBeenCalled();
    });
  });

  describe("empty prereqs", () => {
    it("returns unlocked when prerequisites array is empty", async () => {
      const mock = makePrisma([]);
      const result = await isModuleUnlocked(mock as never, {
        callerId: "caller-1",
        module: makeAuthored("assessment", []),
        playbookConfig: makeConfig([makeAuthored("assessment")]),
        callerRole: "STUDENT",
      });
      expect(result).toEqual({ unlocked: true, reason: "no-prerequisites" });
    });
  });

  describe("string-form prereqs (legacy shape)", () => {
    it("STUDENT blocked when string prereq has no COMPLETED row", async () => {
      const mock = makePrisma([]);
      const result = await isModuleUnlocked(mock as never, {
        callerId: "caller-1",
        module: makeAuthored("part2", ["part1"]),
        playbookConfig: makeConfig([
          makeAuthored("part1"),
          makeAuthored("part2", ["part1"]),
        ]),
        callerRole: "STUDENT",
      });
      expect(result.unlocked).toBe(false);
      expect(result.missing).toHaveLength(1);
      expect(result.missing![0].moduleId).toBe("part1");
      expect(result.missing![0].required).toBe(1);
      expect(result.missing![0].actual).toBe(0);
    });

    it("STUDENT unlocked when string prereq has 1 COMPLETED row", async () => {
      const mock = makePrisma([{ slug: "part1", status: "COMPLETED" }]);
      const result = await isModuleUnlocked(mock as never, {
        callerId: "caller-1",
        module: makeAuthored("part2", ["part1"]),
        playbookConfig: makeConfig([
          makeAuthored("part1"),
          makeAuthored("part2", ["part1"]),
        ]),
        callerRole: "STUDENT",
      });
      expect(result).toEqual({ unlocked: true, reason: "all-prerequisites-met" });
    });
  });

  describe("count-based prereqs (Mock pattern)", () => {
    it("STUDENT blocked when actual < required", async () => {
      // IELTS Mock: needs 2× Part 1 + 2× Part 3. Learner has only 1× P1.
      const mock = makePrisma([
        { slug: "part1", status: "COMPLETED", callCount: 1 },
      ]);
      const result = await isModuleUnlocked(mock as never, {
        callerId: "caller-1",
        module: makeAuthored("mock", [
          { moduleId: "part1", minCompletions: 2 },
          { moduleId: "part3", minCompletions: 2 },
        ]),
        playbookConfig: makeConfig([
          makeAuthored("part1"),
          makeAuthored("part3"),
          makeAuthored("mock"),
        ]),
        callerRole: "STUDENT",
      });
      expect(result.unlocked).toBe(false);
      expect(result.missing).toHaveLength(2);
      const p1 = result.missing!.find((m) => m.moduleId === "part1");
      const p3 = result.missing!.find((m) => m.moduleId === "part3");
      expect(p1!.actual).toBe(1);
      expect(p1!.required).toBe(2);
      expect(p3!.actual).toBe(0);
      expect(p3!.required).toBe(2);
    });

    it("STUDENT unlocked when all count-based prereqs satisfied", async () => {
      const mock = makePrisma([
        { slug: "part1", status: "COMPLETED", callCount: 2 },
        { slug: "part3", status: "COMPLETED", callCount: 2 },
        { slug: "assessment", status: "COMPLETED", callCount: 1 },
      ]);
      const result = await isModuleUnlocked(mock as never, {
        callerId: "caller-1",
        module: makeAuthored("mock", [
          { moduleId: "assessment", minCompletions: 1 },
          { moduleId: "part1", minCompletions: 2 },
          { moduleId: "part3", minCompletions: 2 },
        ]),
        playbookConfig: makeConfig([
          makeAuthored("assessment"),
          makeAuthored("part1"),
          makeAuthored("part3"),
          makeAuthored("mock"),
        ]),
        callerRole: "STUDENT",
      });
      expect(result).toEqual({ unlocked: true, reason: "all-prerequisites-met" });
    });

    it("IN_PROGRESS rows don't count toward minCompletions", async () => {
      const mock = makePrisma([
        { slug: "part1", status: "IN_PROGRESS", callCount: 5 },
      ]);
      const result = await isModuleUnlocked(mock as never, {
        callerId: "caller-1",
        module: makeAuthored("mock", [{ moduleId: "part1", minCompletions: 1 }]),
        playbookConfig: makeConfig([
          makeAuthored("part1"),
          makeAuthored("mock"),
        ]),
        callerRole: "STUDENT",
      });
      expect(result.unlocked).toBe(false);
      expect(result.missing![0].actual).toBe(0);
    });
  });

  describe("mixed-shape prereqs (backwards compat)", () => {
    it("accepts a mix of string + object forms in one array", async () => {
      const mock = makePrisma([
        { slug: "assessment", status: "COMPLETED" },
        { slug: "part1", status: "COMPLETED", callCount: 2 },
      ]);
      const result = await isModuleUnlocked(mock as never, {
        callerId: "caller-1",
        module: makeAuthored("mock", [
          "assessment", // legacy string form, treated as minCompletions=1
          { moduleId: "part1", minCompletions: 2 },
        ]),
        playbookConfig: makeConfig([
          makeAuthored("assessment"),
          makeAuthored("part1"),
          makeAuthored("mock"),
        ]),
        callerRole: "STUDENT",
      });
      expect(result.unlocked).toBe(true);
    });
  });

  describe("missing[] enrichment for UI", () => {
    it("surfaces module label in missing[] when authored entry exists", async () => {
      const mock = makePrisma([]);
      const result = await isModuleUnlocked(mock as never, {
        callerId: "caller-1",
        module: makeAuthored("mock", [{ moduleId: "part1", minCompletions: 2 }]),
        playbookConfig: makeConfig([
          { ...makeAuthored("part1"), label: "Part 1: Familiar Topics" },
          makeAuthored("mock"),
        ]),
        callerRole: "STUDENT",
      });
      expect(result.missing![0].moduleLabel).toBe("Part 1: Familiar Topics");
    });
  });
});
