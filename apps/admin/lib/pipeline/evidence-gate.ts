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
): boolean {
  if (!isEvidenceFirstPlaybook(playbookId)) return false;
  if (hasLearnerEvidence === false) return true;
  if (hasLearnerEvidence === null) return false; // legacy paths
  if (typeof evidenceQuality === "number" && evidenceQuality < EVIDENCE_FIRST_BOAZ_THRESHOLD) {
    return true;
  }
  return false;
}
