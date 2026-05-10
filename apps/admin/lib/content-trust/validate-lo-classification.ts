/**
 * LO classification guard — deterministic rules applied AFTER the AI classifier
 * proposes audience-split fields, BEFORE any DB write to a LearningObjective row
 * or a LoClassification history row.
 *
 * Pattern: AI proposes → guard validates → caller writes (#317).
 *
 * The classifier itself is a hybrid heuristic + LLM step that returns a
 * `LoClassifierProposal`. This guard never trusts that proposal directly.
 * It enforces five invariants:
 *
 *   1. `humanOverriddenAt` is sticky — once set, the LO row is never
 *      rewritten by classifier output (history rows still get logged).
 *   2. `systemRole` must be a valid LoSystemRole — anything else falls
 *      back to NONE so we never write garbage enums.
 *   3. Coherence: `systemRole !== NONE` ⇒ `learnerVisible = false`.
 *      A system-only LO (rubric, item-gen spec, score-explainer) never
 *      surfaces on the learner curriculum.
 *   4. Coherence: `learnerVisible = false` ⇒ `performanceStatement = null`.
 *      Hidden LOs cannot have a learner-facing rewrite — that statement
 *      has no audience.
 *   5. Confidence < 0.8 ⇒ outcome is `queue`, not `apply`. The
 *      LoClassification row is still written (with `applied=false`) so
 *      the review queue can surface it; the LO row is left untouched.
 *
 * The guard is a pure function. Callers are responsible for the actual
 * `tx.learningObjective.update` / `tx.loClassification.create` calls.
 */

import type { LoSystemRole } from "@prisma/client";

// ── Types ──────────────────────────────────────────────

/** What the classifier (heuristic or LLM) proposes for one LO. */
export interface LoClassifierProposal {
  loId: string;
  classifierVersion: string; // model + prompt hash, e.g. "claude-sonnet-4-6@2026-05-09:abc123"
  learnerVisible: boolean;
  performanceStatement: string | null;
  systemRole: LoSystemRole;
  confidence: number; // 0.0-1.0; clamped to range by guard
  rationale?: string | null;
}

/** Subset of LearningObjective fields the guard needs to reason about the target row. */
export interface LoClassifierTarget {
  id: string;
  ref: string;
  description: string;
  humanOverriddenAt: Date | null;
}

export type LoClassifierOutcome = "apply" | "queue" | "skip-overridden";

export interface LoClassifierFix {
  action:
    | "clamped-confidence"
    | "coerced-system-role"
    | "stripped-perf-stmt-on-hidden"
    | "forced-hidden-when-system-role"
    | "blocked-by-human-override"
    | "queued-low-confidence";
  field?: string;
  before?: unknown;
  after?: unknown;
  reason: string;
}

/** Sanitized LO column values the caller should write IF outcome === "apply". */
export interface LoRowUpdates {
  learnerVisible: boolean;
  performanceStatement: string | null;
  systemRole: LoSystemRole;
}

/** Always-write history row — even on queue / skip-overridden. */
export interface ClassificationHistoryRow {
  loId: string;
  classifierVersion: string;
  proposedLearnerVisible: boolean;
  proposedPerformanceStatement: string | null;
  proposedSystemRole: LoSystemRole;
  confidence: number;
  rationale: string | null;
  applied: boolean;
}

export interface LoClassificationDecision {
  outcome: LoClassifierOutcome;
  /** Non-null only when outcome === "apply". */
  loRowUpdates: LoRowUpdates | null;
  /** Always returned — caller writes one LoClassification row per guard call. */
  classificationRow: ClassificationHistoryRow;
  fixes: LoClassifierFix[];
}

// ── Constants ──────────────────────────────────────────

/** Below this, we never auto-apply — always route to the review queue. */
export const CONFIDENCE_APPLY_THRESHOLD = 0.8;

const VALID_SYSTEM_ROLES: ReadonlySet<string> = new Set([
  "ASSESSOR_RUBRIC",
  "ITEM_GENERATOR_SPEC",
  "SCORE_EXPLAINER",
  "TEACHING_INSTRUCTION",
  "NONE",
]);

// ── Guard ──────────────────────────────────────────────

export function validateLoClassification(
  proposal: LoClassifierProposal,
  target: LoClassifierTarget,
): LoClassificationDecision {
  const fixes: LoClassifierFix[] = [];

  // Clamp confidence to [0, 1] before any other reasoning.
  const clampedConfidence = clamp01(proposal.confidence);
  if (clampedConfidence !== proposal.confidence) {
    fixes.push({
      action: "clamped-confidence",
      field: "confidence",
      before: proposal.confidence,
      after: clampedConfidence,
      reason: "confidence must be in [0, 1]",
    });
  }

  // Coerce invalid systemRole to NONE — never write garbage enums.
  let systemRole: LoSystemRole = proposal.systemRole;
  if (!VALID_SYSTEM_ROLES.has(systemRole as string)) {
    fixes.push({
      action: "coerced-system-role",
      field: "systemRole",
      before: systemRole,
      after: "NONE",
      reason: `'${String(systemRole)}' is not a valid LoSystemRole — falling back to NONE`,
    });
    systemRole = "NONE" as LoSystemRole;
  }

  // Coherence rule: systemRole !== NONE ⇒ learnerVisible = false.
  let learnerVisible = proposal.learnerVisible;
  if (systemRole !== "NONE" && learnerVisible) {
    fixes.push({
      action: "forced-hidden-when-system-role",
      field: "learnerVisible",
      before: true,
      after: false,
      reason: `systemRole=${systemRole} implies system-only LO; learnerVisible forced to false`,
    });
    learnerVisible = false;
  }

  // Coherence rule: learnerVisible = false ⇒ performanceStatement = null.
  let performanceStatement: string | null =
    typeof proposal.performanceStatement === "string"
      ? proposal.performanceStatement.trim() || null
      : null;
  if (!learnerVisible && performanceStatement !== null) {
    fixes.push({
      action: "stripped-perf-stmt-on-hidden",
      field: "performanceStatement",
      before: performanceStatement,
      after: null,
      reason: "hidden LO cannot carry a learner-facing performance statement",
    });
    performanceStatement = null;
  }

  // Build the history row (mutable so we can flip `applied` on success).
  const classificationRow: ClassificationHistoryRow = {
    loId: target.id,
    classifierVersion: proposal.classifierVersion,
    proposedLearnerVisible: learnerVisible,
    proposedPerformanceStatement: performanceStatement,
    proposedSystemRole: systemRole,
    confidence: clampedConfidence,
    rationale:
      typeof proposal.rationale === "string"
        ? proposal.rationale.trim() || null
        : null,
    applied: false,
  };

  // Block 1 — humanOverriddenAt sentinel. Never overwrite a human edit.
  if (target.humanOverriddenAt !== null) {
    fixes.push({
      action: "blocked-by-human-override",
      reason: `LO ${target.ref} (${target.id}) has humanOverriddenAt=${target.humanOverriddenAt.toISOString()} — classifier output queued for history only`,
    });
    logFixes(target.ref, "skip-overridden", fixes);
    return {
      outcome: "skip-overridden",
      loRowUpdates: null,
      classificationRow,
      fixes,
    };
  }

  // Block 2 — confidence below threshold. Queue, don't auto-apply.
  if (clampedConfidence < CONFIDENCE_APPLY_THRESHOLD) {
    fixes.push({
      action: "queued-low-confidence",
      reason: `confidence ${clampedConfidence.toFixed(2)} < ${CONFIDENCE_APPLY_THRESHOLD} — routed to review queue`,
    });
    logFixes(target.ref, "queue", fixes);
    return {
      outcome: "queue",
      loRowUpdates: null,
      classificationRow,
      fixes,
    };
  }

  // Apply path — caller writes the LO row + a history row with applied=true.
  classificationRow.applied = true;
  if (fixes.length > 0) logFixes(target.ref, "apply", fixes);
  return {
    outcome: "apply",
    loRowUpdates: {
      learnerVisible,
      performanceStatement,
      systemRole,
    },
    classificationRow,
    fixes,
  };
}

// ── Helpers ────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function logFixes(ref: string, outcome: LoClassifierOutcome, fixes: LoClassifierFix[]): void {
  if (fixes.length === 0) return;
  console.log(
    `[validate-lo-classification] LO ${ref} → ${outcome}: ${fixes.length} fix(es): ` +
      fixes.map((f) => `${f.action}${f.field ? `[${f.field}]` : ""}: ${f.reason}`).join("; "),
  );
}
