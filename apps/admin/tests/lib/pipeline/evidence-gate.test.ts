/**
 * Tests for `lib/pipeline/evidence-gate.ts` — Step 4 of mode-kill #566.
 *
 * Locks the Boaz guard contract: which CallScore rows persist and which
 * get dropped for evidence-first playbooks. Each case maps to a real
 * empirically-observed pattern from Caleb's sim runs on 2026-05-20.
 */

import { describe, it, expect, vi } from "vitest";

// Hoisted mock so we can flip the playbook-list per-test.
const { mockSchedulerConfig } = vi.hoisted(() => ({
  mockSchedulerConfig: {
    evidenceFirstEnabled: true,
    evidenceFirstPlaybooks: ["pb-ielts"] as string[],
  },
}));
vi.mock("@/lib/config", () => ({
  config: {
    scheduler: mockSchedulerConfig,
  },
}));

import {
  shouldSkipForEvidenceFirst,
  EVIDENCE_FIRST_BOAZ_THRESHOLD,
} from "@/lib/pipeline/evidence-gate";

describe("shouldSkipForEvidenceFirst — non-evidence-first playbooks", () => {
  it("never skips a legacy playbook, regardless of evidence fields", () => {
    // Legacy playbook (not in the override list)
    expect(shouldSkipForEvidenceFirst("legacy-pb", false, 0.0)).toBe(false);
    expect(shouldSkipForEvidenceFirst("legacy-pb", false, 0.3)).toBe(false);
    expect(shouldSkipForEvidenceFirst("legacy-pb", true, 0.9)).toBe(false);
    expect(shouldSkipForEvidenceFirst("legacy-pb", null, null)).toBe(false);
  });

  it("never skips when playbookId is null or undefined", () => {
    expect(shouldSkipForEvidenceFirst(null, false, 0.0)).toBe(false);
    expect(shouldSkipForEvidenceFirst(undefined, false, 0.0)).toBe(false);
  });
});

describe("shouldSkipForEvidenceFirst — evidence-first playbook (pb-ielts)", () => {
  it("skips when hasLearnerEvidence is false (Boaz S1-S4 shape)", () => {
    // The exact pattern Caleb's 2026-05-20 sim hit:
    // skill_pronunciation, score=0.60, he=false, eq=0.30
    expect(shouldSkipForEvidenceFirst("pb-ielts", false, 0.3)).toBe(true);
    expect(shouldSkipForEvidenceFirst("pb-ielts", false, 0.0)).toBe(true);
    expect(shouldSkipForEvidenceFirst("pb-ielts", false, 0.9)).toBe(true);
  });

  it("skips when hasLearnerEvidence is true but evidenceQuality is below threshold", () => {
    expect(shouldSkipForEvidenceFirst("pb-ielts", true, 0.0)).toBe(true);
    expect(shouldSkipForEvidenceFirst("pb-ielts", true, EVIDENCE_FIRST_BOAZ_THRESHOLD - 0.01)).toBe(true);
  });

  it("does NOT skip when hasLearnerEvidence is true AND quality is at or above threshold", () => {
    expect(shouldSkipForEvidenceFirst("pb-ielts", true, EVIDENCE_FIRST_BOAZ_THRESHOLD)).toBe(false);
    expect(shouldSkipForEvidenceFirst("pb-ielts", true, 0.8)).toBe(false);
    expect(shouldSkipForEvidenceFirst("pb-ielts", true, 1.0)).toBe(false);
  });

  it("does NOT skip when hasLearnerEvidence is true AND evidenceQuality is null (back-compat with old responses)", () => {
    expect(shouldSkipForEvidenceFirst("pb-ielts", true, null)).toBe(false);
  });

  it("does NOT skip when hasLearnerEvidence is null (legacy scorer paths even within an evidence-first playbook)", () => {
    // Some scorers (mock engine, per-segment runner with old prompt) write
    // null in both fields. We don't drop these — they predate the contract.
    expect(shouldSkipForEvidenceFirst("pb-ielts", null, null)).toBe(false);
    expect(shouldSkipForEvidenceFirst("pb-ielts", null, 0.9)).toBe(false);
  });
});

describe("shouldSkipForEvidenceFirst — flag off", () => {
  it("never skips when EVIDENCE_FIRST_SCORING_ENABLED is false, even for listed playbook", () => {
    mockSchedulerConfig.evidenceFirstEnabled = false;
    try {
      expect(shouldSkipForEvidenceFirst("pb-ielts", false, 0.0)).toBe(false);
      expect(shouldSkipForEvidenceFirst("pb-ielts", true, 0.0)).toBe(false);
    } finally {
      mockSchedulerConfig.evidenceFirstEnabled = true;
    }
  });
});

describe("shouldSkipForEvidenceFirst — Caleb 2026-05-20 contract snapshot", () => {
  // Each row is a real CallScore observation from Caleb's pre-Step-3 sim.
  // The expected skip decision should hold for all future code that
  // imports shouldSkipForEvidenceFirst — protects against silent regression.
  type Obs = { param: string; score: number; he: boolean | null; eq: number | null; expected: boolean };
  const observations: Obs[] = [
    { param: "skill_pronunciation", score: 0.60, he: false, eq: 0.30, expected: true  }, // Boaz pattern — must drop
    { param: "skill_fluency",       score: 0.60, he: true,  eq: 0.90, expected: false }, // real evidence — keep
    { param: "skill_lexical",       score: 0.50, he: true,  eq: 0.80, expected: false }, // real evidence — keep
    { param: "skill_grammar",       score: 0.50, he: true,  eq: 0.90, expected: false }, // real evidence — keep
    { param: "B5-N",                score: 0.70, he: true,  eq: 0.80, expected: false }, // BIG-5 — keep
    { param: "CONV_DOM",            score: 0.20, he: true,  eq: 0.80, expected: false }, // conversation — keep
  ];
  for (const obs of observations) {
    it(`${obs.param} (he=${obs.he}, eq=${obs.eq}, score=${obs.score}) → skip=${obs.expected}`, () => {
      expect(shouldSkipForEvidenceFirst("pb-ielts", obs.he, obs.eq)).toBe(obs.expected);
    });
  }
});
