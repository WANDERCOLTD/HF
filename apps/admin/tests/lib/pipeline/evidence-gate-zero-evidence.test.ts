/**
 * Tests for `shouldSkipForZeroEvidence` — #611 Fix B universal zero-evidence gate.
 *
 * Distinguished from `shouldSkipForEvidenceFirst` (#566 Step 3) which is
 * opt-in per playbook. The universal gate fires regardless of playbook
 * config and protects every course from the 47-param zero-storm bug.
 *
 * See: docs/epic-100-chain-walk.md (Link 4 — CALL → SCORE)
 *      gh issue view 611
 */

import { describe, it, expect } from "vitest";
import { shouldSkipForZeroEvidence } from "@/lib/pipeline/evidence-gate";

describe("shouldSkipForZeroEvidence — universal #611 Fix B gate", () => {
  it("DROPS rows with hasLearnerEvidence=false AND evidenceQuality=0", () => {
    // The exact zero-storm shape — scorer reported no learner evidence,
    // zero quality, and the legacy code wrote the row anyway with score=0.
    expect(shouldSkipForZeroEvidence(false, 0)).toBe(true);
  });

  it("KEEPS rows with hasLearnerEvidence=false but evidenceQuality>0", () => {
    // Edge case: scorer says no learner evidence but assigns non-zero
    // quality. This is rare but valid (e.g. learner gave a one-word answer
    // that the AI counted as partial signal). Universal gate does NOT drop;
    // the #566 evidence-first guard may still drop these for IELTS-class
    // playbooks via a separate rule.
    expect(shouldSkipForZeroEvidence(false, 0.3)).toBe(false);
    expect(shouldSkipForZeroEvidence(false, 0.5)).toBe(false);
    expect(shouldSkipForZeroEvidence(false, 1.0)).toBe(false);
  });

  it("KEEPS rows with hasLearnerEvidence=true regardless of quality", () => {
    expect(shouldSkipForZeroEvidence(true, 0)).toBe(false);
    expect(shouldSkipForZeroEvidence(true, 0.5)).toBe(false);
    expect(shouldSkipForZeroEvidence(true, 1.0)).toBe(false);
  });

  it("KEEPS legacy null-sentinel rows (back-compat with old prompt format)", () => {
    // Critical: pre-evidence-aware prompts return null for both fields.
    // The universal gate MUST NOT drop those — many of them are
    // legitimate-zero measurements from older calls, and silently losing
    // them would be a worse regression than the bug we're fixing.
    expect(shouldSkipForZeroEvidence(null, null)).toBe(false);
    expect(shouldSkipForZeroEvidence(null, 0)).toBe(false);
    expect(shouldSkipForZeroEvidence(null, 0.5)).toBe(false);
    expect(shouldSkipForZeroEvidence(false, null)).toBe(false);
    expect(shouldSkipForZeroEvidence(true, null)).toBe(false);
  });

  it("is playbook-agnostic — no playbookId argument", () => {
    // Type assertion + behavioural check — confirm the function signature
    // does not depend on playbook context (that's `shouldSkipForEvidenceFirst`).
    expect(shouldSkipForZeroEvidence.length).toBe(2);
  });
});
