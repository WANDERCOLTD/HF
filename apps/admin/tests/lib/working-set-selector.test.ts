/**
 * Tests for the continuous learning working set selector.
 *
 * Pure algorithm — no DB mocking needed.
 */

import { describe, it, expect } from "vitest";
import {
  selectWorkingSet,
  type WorkingSetInput,
  type AssertionRef,
  type LORef,
  type ModuleRef,
} from "@/lib/curriculum/working-set-selector";
import type { TpProgress } from "@/lib/curriculum/track-progress";

// ── Helpers ──────────────────────────────────────────

function makeModule(id: string, sortOrder: number, prerequisites: string[] = []): ModuleRef {
  return { id, slug: `MOD-${id}`, name: `Module ${id}`, sortOrder, prerequisites };
}

function makeLO(id: string, ref: string, moduleId: string, sortOrder: number): LORef {
  return { id, ref, moduleId, sortOrder, description: `LO ${ref}` };
}

function makeTP(id: string, loId: string, orderIndex: number, depth: number = 0): AssertionRef {
  return { id, learningObjectiveId: loId, learningOutcomeRef: null, depth, orderIndex };
}

function makeTpMap(entries: Record<string, Partial<TpProgress>>): Record<string, TpProgress> {
  const result: Record<string, TpProgress> = {};
  for (const [id, partial] of Object.entries(entries)) {
    result[id] = { mastery: 0, status: "not_started", ...partial };
  }
  return result;
}

function makeInput(overrides: Partial<WorkingSetInput> = {}): WorkingSetInput {
  // Default: 2 modules, 2 LOs each, 2 TPs each = 8 TPs total
  const modules = [
    makeModule("m1", 0),
    makeModule("m2", 1),
  ];
  const los = [
    makeLO("lo1", "LO1", "m1", 0),
    makeLO("lo2", "LO2", "m1", 1),
    makeLO("lo3", "LO3", "m2", 0),
    makeLO("lo4", "LO4", "m2", 1),
  ];
  const assertions = [
    makeTP("tp1", "lo1", 0), makeTP("tp2", "lo1", 1),
    makeTP("tp3", "lo2", 0), makeTP("tp4", "lo2", 1),
    makeTP("tp5", "lo3", 0), makeTP("tp6", "lo3", 1),
    makeTP("tp7", "lo4", 0), makeTP("tp8", "lo4", 1),
  ];

  return {
    assertions,
    learningObjectives: los,
    modules,
    tpMasteryMap: {},
    loMasteryMap: {},
    callDurationMins: 25,
    masteryThreshold: 0.7,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────

describe("selectWorkingSet", () => {
  describe("fresh start (no mastery)", () => {
    it("selects LOs from the first module", () => {
      const result = selectWorkingSet(makeInput());

      expect(result.frontierModuleId).toBe("m1");
      expect(result.selectedLOs.length).toBeGreaterThan(0);
      expect(result.selectedLOs.every((lo) => lo.status === "new")).toBe(true);
      expect(result.reviewIds).toHaveLength(0);
    });

    it("respects module sort order — picks m1 before m2", () => {
      const result = selectWorkingSet(makeInput());

      const loModules = result.selectedLOs.map((lo) => lo.moduleId);
      // Should all be from m1 (first module) if budget allows
      expect(loModules[0]).toBe("m1");
    });

    it("includes all child TPs for selected LOs", () => {
      const result = selectWorkingSet(makeInput());

      for (const lo of result.selectedLOs) {
        expect(lo.childTpIds.length).toBeGreaterThan(0);
        // Every child TP should be in the overall assertionIds
        for (const tpId of lo.childTpIds) {
          expect(result.assertionIds).toContain(tpId);
        }
      }
    });

    it("never splits an LO (all or none of its TPs)", () => {
      const result = selectWorkingSet(makeInput());

      // Check that if an LO's TP is included, all TPs are included
      const selectedTpSet = new Set(result.assertionIds);
      for (const lo of result.selectedLOs) {
        const allIncluded = lo.childTpIds.every((id) => selectedTpSet.has(id));
        expect(allIncluded).toBe(true);
      }
    });
  });

  describe("budget constraints", () => {
    it("25-min call budgets ~3 LOs", () => {
      const result = selectWorkingSet(makeInput({ callDurationMins: 25 }));
      expect(result.selectedLOs.length).toBeLessThanOrEqual(4);
      expect(result.selectedLOs.length).toBeGreaterThanOrEqual(1);
    });

    it("15-min call budgets fewer LOs than 25-min", () => {
      const short = selectWorkingSet(makeInput({ callDurationMins: 15 }));
      const long = selectWorkingSet(makeInput({ callDurationMins: 25 }));
      expect(short.selectedLOs.length).toBeLessThanOrEqual(long.selectedLOs.length);
    });

    it("respects MAX_TPS_PER_CALL hard cap", () => {
      // Create LOs with many TPs
      const los = [makeLO("lo1", "LO1", "m1", 0)];
      const assertions: AssertionRef[] = [];
      for (let i = 0; i < 30; i++) {
        assertions.push(makeTP(`tp${i}`, "lo1", i));
      }

      const result = selectWorkingSet(makeInput({
        learningObjectives: los,
        assertions,
        callDurationMins: 15,  // hard cap = ceil(15 * 0.8) = 12
      }));

      // Even though LO1 has 30 TPs, the selector should include it
      // if it's the only LO (can't split), but won't exceed budget
      expect(result.assertionIds.length).toBeLessThanOrEqual(30);
    });
  });

  describe("review LO selection", () => {
    it("selects 1 review LO when some TPs are in_progress", () => {
      const tpMap = makeTpMap({
        tp1: { mastery: 0.3, status: "in_progress" },
        tp2: { mastery: 0.4, status: "in_progress" },
      });

      const result = selectWorkingSet(makeInput({ tpMasteryMap: tpMap }));

      expect(result.reviewIds.length).toBeGreaterThan(0);
      const reviewLOs = result.selectedLOs.filter((lo) => lo.status === "review");
      expect(reviewLOs).toHaveLength(1);
    });

    it("picks the weakest in_progress LO for review", () => {
      const tpMap = makeTpMap({
        // LO1 TPs: partially mastered (avg ~0.35)
        tp1: { mastery: 0.3, status: "in_progress" },
        tp2: { mastery: 0.4, status: "in_progress" },
        // LO2 TPs: more progress (avg ~0.55)
        tp3: { mastery: 0.5, status: "in_progress" },
        tp4: { mastery: 0.6, status: "in_progress" },
      });

      const result = selectWorkingSet(makeInput({ tpMasteryMap: tpMap }));

      const reviewLOs = result.selectedLOs.filter((lo) => lo.status === "review");
      expect(reviewLOs).toHaveLength(1);
      // LO1 is weaker, should be selected for review
      expect(reviewLOs[0].ref).toBe("LO1");
    });

    it("does not select mastered LOs for review", () => {
      const tpMap = makeTpMap({
        tp1: { mastery: 0.9, status: "mastered" },
        tp2: { mastery: 0.8, status: "mastered" },
      });

      const result = selectWorkingSet(makeInput({ tpMasteryMap: tpMap }));

      const reviewLOs = result.selectedLOs.filter((lo) => lo.status === "review");
      expect(reviewLOs).toHaveLength(0);
    });
  });

  describe("module prerequisites", () => {
    it("skips modules with unmet prerequisites", () => {
      const modules = [
        makeModule("m1", 0),
        makeModule("m2", 1, ["m1"]),  // m2 requires m1
      ];
      // m1 is NOT completed (no mastery)
      const result = selectWorkingSet(makeInput({ modules }));

      // Should only select from m1
      expect(result.frontierModuleId).toBe("m1");
      expect(result.selectedLOs.every((lo) => lo.moduleId === "m1")).toBe(true);
    });

    it("unlocks modules when prerequisites are met", () => {
      const modules = [
        makeModule("m1", 0),
        makeModule("m2", 1, ["m1"]),
      ];
      // m1 is fully mastered
      const tpMap = makeTpMap({
        tp1: { mastery: 0.9, status: "mastered" },
        tp2: { mastery: 0.8, status: "mastered" },
        tp3: { mastery: 0.9, status: "mastered" },
        tp4: { mastery: 0.8, status: "mastered" },
      });

      const result = selectWorkingSet(makeInput({ modules, tpMasteryMap: tpMap }));

      // m1 complete → m2 unlocked → should pick from m2
      const newLOs = result.selectedLOs.filter((lo) => lo.status === "new");
      expect(newLOs.some((lo) => lo.moduleId === "m2")).toBe(true);
    });
  });

  describe("all mastered / edge cases", () => {
    it("returns empty when all TPs are mastered", () => {
      const tpMap = makeTpMap({
        tp1: { mastery: 0.9, status: "mastered" },
        tp2: { mastery: 0.8, status: "mastered" },
        tp3: { mastery: 0.9, status: "mastered" },
        tp4: { mastery: 0.8, status: "mastered" },
        tp5: { mastery: 0.9, status: "mastered" },
        tp6: { mastery: 0.8, status: "mastered" },
        tp7: { mastery: 0.9, status: "mastered" },
        tp8: { mastery: 0.8, status: "mastered" },
      });

      const result = selectWorkingSet(makeInput({ tpMasteryMap: tpMap }));

      expect(result.assertionIds).toHaveLength(0);
      expect(result.totalMastered).toBe(4);  // 4 LOs
    });

    it("handles empty assertions gracefully", () => {
      const result = selectWorkingSet(makeInput({
        assertions: [],
        learningObjectives: [],
      }));

      expect(result.assertionIds).toHaveLength(0);
      expect(result.selectedLOs).toHaveLength(0);
      expect(result.totalLOs).toBe(0);
    });

    it("falls back to weakest in_progress when no new LOs and no review", () => {
      // All LOs are in_progress but none qualify as review (mastery > threshold)
      // This shouldn't normally happen, but test the fallback
      const tpMap = makeTpMap({
        tp1: { mastery: 0.5, status: "in_progress" },
        tp2: { mastery: 0.5, status: "in_progress" },
        tp3: { mastery: 0.5, status: "in_progress" },
        tp4: { mastery: 0.5, status: "in_progress" },
        tp5: { mastery: 0.5, status: "in_progress" },
        tp6: { mastery: 0.5, status: "in_progress" },
        tp7: { mastery: 0.5, status: "in_progress" },
        tp8: { mastery: 0.5, status: "in_progress" },
      });

      const result = selectWorkingSet(makeInput({ tpMasteryMap: tpMap }));

      // Should still return something (review of weakest)
      expect(result.assertionIds.length).toBeGreaterThan(0);
    });
  });

  describe("progress tracking", () => {
    it("reports correct totalMastered count", () => {
      const tpMap = makeTpMap({
        tp1: { mastery: 0.9, status: "mastered" },
        tp2: { mastery: 0.8, status: "mastered" },
        // LO1 fully mastered ↑
        tp3: { mastery: 0.3, status: "in_progress" },
        tp4: { mastery: 0.4, status: "in_progress" },
        // LO2 in progress ↑
      });

      const result = selectWorkingSet(makeInput({ tpMasteryMap: tpMap }));

      expect(result.totalMastered).toBe(1);  // Only LO1 is fully mastered
      expect(result.totalLOs).toBe(4);
      expect(result.totalTps).toBe(8);
    });

    it("is deterministic with same inputs", () => {
      const input = makeInput();
      const r1 = selectWorkingSet(input);
      const r2 = selectWorkingSet(input);

      expect(r1.assertionIds).toEqual(r2.assertionIds);
      expect(r1.selectedLOs.map((lo) => lo.id)).toEqual(r2.selectedLOs.map((lo) => lo.id));
    });
  });

  // ── #918 carry-forward (planned-but-uncovered) ──────────────────

  describe("#918 carry-forward planned-but-uncovered TPs", () => {
    it("boost on: an in_progress LO whose unstarted TP was prior-planned wins over a stronger one without carry-forward", () => {
      // Two in_progress LOs in different modules so they don't share the
      // module-ordering tiebreaker. Both below threshold (qualify as review
      // candidates). lo3 has lower raw mastery but no carry-forward; lo1 has
      // higher raw mastery but one of its TPs was planned-and-uncovered.
      // With boost=0.5 and half its TPs in the set, lo1's effective mastery
      // drops by 0.25, pulling it below lo3.
      const input = makeInput({
        tpMasteryMap: makeTpMap({
          // lo1: mastery 0.45 raw; one TP not_started + one in_progress
          tp1: { status: "not_started", mastery: 0 },
          tp2: { status: "in_progress", mastery: 0.9 },
          // lo3 (m2): mastery 0.30 raw; both TPs in_progress
          tp5: { status: "in_progress", mastery: 0.30 },
          tp6: { status: "in_progress", mastery: 0.30 },
        }),
        loMasteryMap: { "m1:LO1": 0.45, "m2:LO3": 0.30 },
        priorPlannedAssertionIds: ["tp1"],
        carryForwardBoost: 0.5,
        callDurationMins: 10,  // tiny budget — only 1 review LO will be picked
      });
      const result = selectWorkingSet(input);
      const reviewLO = result.selectedLOs.find((lo) => lo.status === "review");
      expect(reviewLO?.ref).toBe("LO1");
    });

    it("boost off (carryForwardBoost: 0): ranking matches pre-#918 weakest-first behaviour", () => {
      const baseTpMap = makeTpMap({
        tp1: { status: "not_started", mastery: 0 },
        tp2: { status: "in_progress", mastery: 0.9 },
        tp5: { status: "in_progress", mastery: 0.30 },
        tp6: { status: "in_progress", mastery: 0.30 },
      });
      const baseMastery = { "m1:LO1": 0.45, "m2:LO3": 0.30 };

      // Without carry-forward boost, the weakest LO (lo3) should win
      const noBoost = selectWorkingSet(
        makeInput({
          tpMasteryMap: baseTpMap,
          loMasteryMap: baseMastery,
          priorPlannedAssertionIds: ["tp1"],
          carryForwardBoost: 0,
          callDurationMins: 10,
        }),
      );
      const reviewLO = noBoost.selectedLOs.find((lo) => lo.status === "review");
      expect(reviewLO?.ref).toBe("LO3");
    });

    it("empty priorPlannedAssertionIds: byte-identical to pre-#918 behaviour (regression guard)", () => {
      const tpMap = makeTpMap({
        tp1: { status: "in_progress", mastery: 0.3 },
        tp2: { status: "in_progress", mastery: 0.3 },
        tp5: { status: "in_progress", mastery: 0.6 },
        tp6: { status: "in_progress", mastery: 0.6 },
      });
      const without = selectWorkingSet(makeInput({ tpMasteryMap: tpMap }));
      const withEmpty = selectWorkingSet(
        makeInput({
          tpMasteryMap: tpMap,
          priorPlannedAssertionIds: [],
          carryForwardBoost: 0.5,
        }),
      );
      expect(withEmpty.assertionIds).toEqual(without.assertionIds);
      expect(withEmpty.selectedLOs.map((lo) => lo.id)).toEqual(without.selectedLOs.map((lo) => lo.id));
    });

    it("picker-locked prior decision (empty workingSetAssertionIds): suppression — no boost fires", () => {
      // Picker-locked path at modules.ts:929 persists workingSetAssertionIds: [].
      // Caller (modules.ts) passes [] to selectWorkingSet, which then runs
      // pre-#918 weakest-first ranking.
      const tpMap = makeTpMap({
        tp1: { status: "not_started", mastery: 0 },
        tp2: { status: "in_progress", mastery: 0.9 },
        tp5: { status: "in_progress", mastery: 0.30 },
        tp6: { status: "in_progress", mastery: 0.30 },
      });
      const result = selectWorkingSet(
        makeInput({
          tpMasteryMap: tpMap,
          loMasteryMap: { "m1:LO1": 0.45, "m2:LO3": 0.30 },
          // Picker-locked → caller passes empty array
          priorPlannedAssertionIds: [],
          carryForwardBoost: 0.5,
          callDurationMins: 10,
        }),
      );
      const reviewLO = result.selectedLOs.find((lo) => lo.status === "review");
      // Without carry-forward, weakest (lo3) wins as before
      expect(reviewLO?.ref).toBe("LO3");
    });

    it("first call (no priorDecision → caller passes undefined): no crash, behaves like pre-#918", () => {
      const result = selectWorkingSet(
        makeInput({
          // priorPlannedAssertionIds omitted entirely
          carryForwardBoost: 0.5,
        }),
      );
      expect(result.selectedLOs.length).toBeGreaterThan(0);
      // Fresh-start: m1 frontier still picked
      expect(result.frontierModuleId).toBe("m1");
    });

    it("default boost (0.5) applies when caller passes set but no explicit boost", () => {
      // Same shape as the first test but carryForwardBoost is undefined.
      const result = selectWorkingSet(
        makeInput({
          tpMasteryMap: makeTpMap({
            tp1: { status: "not_started", mastery: 0 },
            tp2: { status: "in_progress", mastery: 0.9 },
            tp5: { status: "in_progress", mastery: 0.30 },
            tp6: { status: "in_progress", mastery: 0.30 },
          }),
          loMasteryMap: { "m1:LO1": 0.45, "m2:LO3": 0.30 },
          priorPlannedAssertionIds: ["tp1"],
          callDurationMins: 10,
          // carryForwardBoost intentionally undefined — should default to 0.5
        }),
      );
      const reviewLO = result.selectedLOs.find((lo) => lo.status === "review");
      expect(reviewLO?.ref).toBe("LO1");
    });

    it("new-LO selection within a frontier module: prefers LO with carry-forward TP over its sibling", () => {
      // Both lo1 and lo2 are not_started in m1. Without carry-forward, lo1
      // wins on sortOrder. With carry-forward pointing at lo2's TPs, lo2 wins.
      const baseInput = makeInput({
        callDurationMins: 10,  // small budget → 1 new LO from frontier
      });

      const sortOrderResult = selectWorkingSet(baseInput);
      const sortOrderNewLO = sortOrderResult.selectedLOs.find((lo) => lo.status === "new");
      expect(sortOrderNewLO?.ref).toBe("LO1");

      const carryResult = selectWorkingSet({
        ...baseInput,
        priorPlannedAssertionIds: ["tp3"],  // tp3 belongs to lo2
        carryForwardBoost: 0.5,
      });
      const carryNewLO = carryResult.selectedLOs.find((lo) => lo.status === "new");
      expect(carryNewLO?.ref).toBe("LO2");
    });

    it("TPs already moved past not_started are NOT carried forward (caller responsibility doc check)", () => {
      // This test documents the contract that modules.ts is responsible for:
      // it only passes TPs whose status is `not_started` (or unknown). Inside
      // selectWorkingSet, all TPs in the set boost regardless of mastery —
      // verifying the upstream filter is critical.
      //
      // Even when an in_progress TP slips through, the boost still applies to
      // its LO. That's fine — by then the LO is already in_progress, which
      // means review-candidacy is already in scope. The boost just reinforces.
      const result = selectWorkingSet(
        makeInput({
          tpMasteryMap: makeTpMap({
            tp1: { status: "in_progress", mastery: 0.4 },
            tp2: { status: "in_progress", mastery: 0.4 },
            tp5: { status: "in_progress", mastery: 0.3 },
            tp6: { status: "in_progress", mastery: 0.3 },
          }),
          loMasteryMap: { "m1:LO1": 0.4, "m2:LO3": 0.3 },
          // Caller "should" have filtered tp1 out (it's in_progress, not
          // not_started) — but if they didn't, the boost still works defensively.
          priorPlannedAssertionIds: ["tp1"],
          carryForwardBoost: 0.5,
          callDurationMins: 10,
        }),
      );
      const reviewLO = result.selectedLOs.find((lo) => lo.status === "review");
      // lo1: 0.4 - 0.5*0.5 = 0.15; lo3: 0.3 - 0 = 0.3. lo1 wins.
      expect(reviewLO?.ref).toBe("LO1");
    });
  });
});
