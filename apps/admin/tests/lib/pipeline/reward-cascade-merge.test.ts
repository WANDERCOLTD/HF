/**
 * reward-cascade-merge.test.ts (#1641)
 *
 * Pins the SYSTEM + PLAYBOOK cascade-merge contract on REWARD's target
 * lookup. The diff loop in `computeReward` reads from a Map populated
 * by an OR-where findMany + a two-pass merge; pinning the merge shape
 * separately from the inline call site keeps the test light + readable.
 *
 * The bug class this guard against: REWARD previously loaded SYSTEM
 * targets only, so STRUCTURED courses with PLAYBOOK-scope skill_*
 * targets (e.g. IELTS Speaking V1.0) had every BehaviorMeasurement
 * marked as unmatched and the #1632 guard threw "0 measurements
 * matched a SYSTEM target". The merge gives PLAYBOOK precedence over
 * SYSTEM on parameterId collision so a course-specific override (e.g.
 * BEH-WARMTH PLAYBOOK=0.21 vs SYSTEM=0.5) wins the diff comparison.
 */
import { describe, it, expect } from "vitest";

interface TargetRow {
  parameterId: string;
  scope: "SYSTEM" | "PLAYBOOK" | "CALLER";
  targetValue: number;
  playbookId?: string | null;
}

/** Mirrors the inline merge in `route.ts::computeReward`. */
function mergeCascade(rawTargets: TargetRow[]): Map<string, TargetRow> {
  const targetByParam = new Map<string, TargetRow>();
  for (const t of rawTargets) {
    if (t.scope === "SYSTEM") targetByParam.set(t.parameterId, t);
  }
  for (const t of rawTargets) {
    if (t.scope === "PLAYBOOK") targetByParam.set(t.parameterId, t);
  }
  return targetByParam;
}

describe("REWARD SYSTEM + PLAYBOOK cascade merge (#1641)", () => {
  it("PLAYBOOK target overrides SYSTEM target on parameterId collision", () => {
    const merged = mergeCascade([
      { parameterId: "BEH-WARMTH", scope: "SYSTEM", targetValue: 0.5 },
      { parameterId: "BEH-WARMTH", scope: "PLAYBOOK", targetValue: 0.21, playbookId: "pb-A" },
    ]);
    const warmth = merged.get("BEH-WARMTH");
    expect(warmth?.scope).toBe("PLAYBOOK");
    expect(warmth?.targetValue).toBe(0.21);
  });

  it("PLAYBOOK-only targets win when no SYSTEM sibling exists (the IELTS skill_* case)", () => {
    const merged = mergeCascade([
      { parameterId: "BEH-WARMTH", scope: "SYSTEM", targetValue: 0.5 },
      { parameterId: "skill_fluency_and_coherence_fc", scope: "PLAYBOOK", targetValue: 0.7, playbookId: "pb-A" },
      { parameterId: "skill_grammatical_range_and_accuracy_gra", scope: "PLAYBOOK", targetValue: 0.7, playbookId: "pb-A" },
    ]);
    expect(merged.size).toBe(3);
    expect(merged.get("skill_fluency_and_coherence_fc")?.scope).toBe("PLAYBOOK");
    expect(merged.get("skill_fluency_and_coherence_fc")?.targetValue).toBe(0.7);
  });

  it("SYSTEM-only targets pass through unchanged when no PLAYBOOK exists", () => {
    const merged = mergeCascade([
      { parameterId: "BEH-WARMTH", scope: "SYSTEM", targetValue: 0.5 },
      { parameterId: "BEH-FORMALITY", scope: "SYSTEM", targetValue: 0.5 },
    ]);
    expect(merged.size).toBe(2);
    expect(merged.get("BEH-WARMTH")?.scope).toBe("SYSTEM");
    expect(merged.get("BEH-FORMALITY")?.scope).toBe("SYSTEM");
  });

  it("empty input → empty map", () => {
    expect(mergeCascade([]).size).toBe(0);
  });

  it("ignores CALLER-scope rows in this layer (ADAPT writes those, not REWARD)", () => {
    // ADAPT's `updateTargets` sub-op writes CALLER-scope rows after
    // REWARD. The cascade-merge layer above sees PLAYBOOK + SYSTEM only.
    const merged = mergeCascade([
      { parameterId: "BEH-WARMTH", scope: "SYSTEM", targetValue: 0.5 },
      { parameterId: "BEH-WARMTH", scope: "CALLER", targetValue: 0.9 },
    ]);
    expect(merged.get("BEH-WARMTH")?.scope).toBe("SYSTEM");
    expect(merged.get("BEH-WARMTH")?.targetValue).toBe(0.5);
  });

  it("Freddy Starr real-data fixture: skill_* PLAYBOOK + BEH-* PLAYBOOK over BEH-* SYSTEM", () => {
    // Live diff from hf-dev sandbox 2026-06-14 — IELTS PLS USE NEW
    // V1.0 playbook (ec4127a1). Pre-#1641 REWARD's SYSTEM-only load
    // missed ALL these PLAYBOOK targets, throwing the #1632 guard.
    const merged = mergeCascade([
      // SYSTEM defaults
      { parameterId: "BEH-WARMTH", scope: "SYSTEM", targetValue: 0.5 },
      { parameterId: "BEH-FORMALITY", scope: "SYSTEM", targetValue: 0.5 },
      { parameterId: "BEH-CONVERSATIONAL-TONE", scope: "SYSTEM", targetValue: 0.5 },
      { parameterId: "BEH-RESPONSE-LEN", scope: "SYSTEM", targetValue: 0.5 },
      // PLAYBOOK overrides
      { parameterId: "BEH-WARMTH", scope: "PLAYBOOK", targetValue: 0.21, playbookId: "ec4127a1" },
      { parameterId: "BEH-FORMALITY", scope: "PLAYBOOK", targetValue: 0.4, playbookId: "ec4127a1" },
      { parameterId: "BEH-CONVERSATIONAL-TONE", scope: "PLAYBOOK", targetValue: 0.48, playbookId: "ec4127a1" },
      { parameterId: "BEH-RESPONSE-LEN", scope: "PLAYBOOK", targetValue: 0.44, playbookId: "ec4127a1" },
      // PLAYBOOK-only (skill family)
      { parameterId: "skill_fluency_and_coherence_fc", scope: "PLAYBOOK", targetValue: 0.7, playbookId: "ec4127a1" },
      { parameterId: "skill_grammatical_range_and_accuracy_gra", scope: "PLAYBOOK", targetValue: 0.7, playbookId: "ec4127a1" },
    ]);
    expect(merged.size).toBe(6);
    expect(merged.get("BEH-WARMTH")?.targetValue).toBe(0.21);
    expect(merged.get("BEH-FORMALITY")?.targetValue).toBe(0.4);
    expect(merged.get("skill_fluency_and_coherence_fc")?.targetValue).toBe(0.7);
    expect(merged.get("skill_fluency_and_coherence_fc")?.scope).toBe("PLAYBOOK");
  });
});
