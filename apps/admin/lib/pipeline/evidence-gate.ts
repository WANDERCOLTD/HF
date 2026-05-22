/**
 * Evidence gate — Step 4 of the mode-kill epic (#566).
 *
 * Tiny helper extracted from `pipeline/route.ts` so the Boaz guard rule
 * is unit-testable without dragging the entire 3000-line pipeline route
 * into the test runner.
 *
 * The guard is the per-parameter persistence decision used by
 * evidence-first playbooks. For non-listed playbooks (legacy paths) the
 * gate always returns `false` (= "do not skip") so the existing
 * mode-based event-gate keeps full control of allow/deny.
 *
 * Decision shape (when `isEvidenceFirstPlaybook` returns true):
 *   hasLearnerEvidence | evidenceQuality   | skip?
 *   ------------------ | -----------------  | -----
 *   true               | any                | false
 *   true               | < 0.4              | true   (low-quality evidence)
 *   false              | any                | true   (Boaz S1-S4 shape)
 *   null               | any                | false  (legacy paths — leave alone)
 */

import { isEvidenceFirstPlaybook } from "./event-gate";

/**
 * Threshold below which evidenceQuality is treated as "not enough" even
 * when the scorer claims hasLearnerEvidence=true. The chosen value 0.4
 * matches the Boaz S1-S4 manual review threshold used in the audit log.
 */
export const EVIDENCE_FIRST_BOAZ_THRESHOLD = 0.4;

/**
 * Returns true when the row should be DROPPED (not persisted).
 *
 * Non-evidence-first playbooks: always false (do not skip — defer to the
 * existing event-gate and persistence path).
 *
 * Evidence-first playbooks: skip when the scorer LLM judged that no
 * learner evidence was present, or when evidence quality is below the
 * Boaz threshold even with hasLearnerEvidence=true.
 */
export function shouldSkipForEvidenceFirst(
  playbookId: string | null | undefined,
  hasLearnerEvidence: boolean | null,
  evidenceQuality: number | null,
  /**
   * Optional Playbook.config to honour `scoringMode: "evidence-first"`
   * declarations from the course-ref front-matter (#UI-followup Gap 1).
   * Falls back to the hardcoded ID list when omitted; passing it widens
   * coverage to fresh courses without a JSON edit + redeploy.
   */
  playbookConfig?: Record<string, unknown> | null,
): boolean {
  if (!isEvidenceFirstPlaybook(playbookId, playbookConfig)) return false;
  if (hasLearnerEvidence === false) return true;
  if (hasLearnerEvidence === null) return false; // legacy paths
  if (typeof evidenceQuality === "number" && evidenceQuality < EVIDENCE_FIRST_BOAZ_THRESHOLD) {
    return true;
  }
  return false;
}

/**
 * #611 Fix B — universal zero-evidence gate. Returns true when a CallScore
 * row should be dropped because the scorer LLM explicitly reported the
 * learner produced no evidence AND the evidence quality is zero. Fires
 * regardless of playbook ID, scheduler config, or evidence-first allowlist.
 *
 * Distinguished from `shouldSkipForEvidenceFirst`:
 *   - That guard is OPT-IN by playbook (evidence-first allowlist + config).
 *   - This guard is UNIVERSAL — every playbook gets it.
 *
 * Legacy null-sentinel path (either field is null) returns false so prompts
 * that pre-date evidence-aware scoring keep their existing semantics —
 * silently dropping legitimate-zero rows on legacy prompts would be a
 * regression we cannot tolerate.
 *
 * See: docs/epic-100-chain-walk.md (Link 4 — CALL → SCORE)
 *      gh issue view 611 (Symptom 2 — 47-param zero-storm)
 */
export function shouldSkipForZeroEvidence(
  hasLearnerEvidence: boolean | null,
  evidenceQuality: number | null,
): boolean {
  return hasLearnerEvidence === false && evidenceQuality === 0;
}
