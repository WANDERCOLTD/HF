import { config } from "@/lib/config";
import { readSchedulerDecision, type SchedulerMode } from "./scheduler-decision";

/**
 * Slice 1 — Micro-MVP event-gate for EXTRACT scoring (#154).
 *
 * Fixes Boaz S1–S4: skills were being scored even when no evidence existed
 * that the student had been assessed (e.g. COMP_VOCABULARY scored 0.85 in a
 * teach-only session). The gate reads the previous call's SchedulerDecision
 * and only allows caller-skill scoring when the prior mode was "assess" or
 * "practice".
 *
 * Default-allow semantics:
 *   - No decision on file (first call, structured mode, legacy caller) → allow.
 *     Structured-mode lessons plans have always scored every call; preserving
 *     that avoids a silent behaviour change outside continuous mode.
 *   - Decision on file with mode "teach" or "review" → deny.
 *   - Decision on file with mode "assess" or "practice" → allow.
 *
 * Slices 2 and 3 replace the per-mode allow/deny with per-paramId gating once
 * the real scheduler can emit a working set tagged with assessment coverage.
 *
 * Mode-kill epic #566 — Step 3:
 *   When the call's playbook is listed in `evidence-first-playbooks.json`
 *   AND the global flag `EVIDENCE_FIRST_SCORING_ENABLED` is true, this gate
 *   short-circuits to allow=true with mode="evidence-first". The downstream
 *   scorer + persistence layer enforces per-parameter Boaz protection using
 *   the `hasLearnerEvidence` field (Step 1) and the pre-filter (Step 2).
 *   The legacy mode-gate is preserved for all other playbooks.
 */

export interface EventGateResult {
  allow: boolean;
  mode: SchedulerMode | "unknown" | "evidence-first";
  reason: string;
}

/**
 * Determines whether the given playbook should bypass the mode-based gate
 * and route through evidence-first per-parameter scoring instead.
 *
 * Returns true only when:
 *   1. `EVIDENCE_FIRST_SCORING_ENABLED` env flag is "true"
 *   2. `playbookId` is non-null AND present in `evidence-first-playbooks.json`
 *
 * Either condition false → returns false → legacy mode-gate handles the call.
 */
export function isEvidenceFirstPlaybook(playbookId: string | null | undefined): boolean {
  if (!playbookId) return false;
  if (!config.scheduler.evidenceFirstEnabled) return false;
  return config.scheduler.evidenceFirstPlaybooks.includes(playbookId);
}

export async function shouldRunCallerAnalysis(
  callerId: string,
  playbookId?: string | null,
): Promise<EventGateResult> {
  // #566 Step 3 — evidence-first override.
  if (isEvidenceFirstPlaybook(playbookId)) {
    return {
      allow: true,
      mode: "evidence-first",
      reason: `playbook ${playbookId} is opted into evidence-first scoring — per-parameter decisions delegated to scorer (hasLearnerEvidence) and pre-filter`,
    };
  }

  const prior = await readSchedulerDecision(callerId);

  if (!prior) {
    return {
      allow: true,
      mode: "unknown",
      reason: "no prior SchedulerDecision (first call, structured mode, or legacy caller)",
    };
  }

  const allowedModes = config.scheduler.assessmentModes;
  if (allowedModes.includes(prior.mode)) {
    return {
      allow: true,
      mode: prior.mode,
      reason: `prior decision mode=${prior.mode} — assessment evidence expected`,
    };
  }

  return {
    allow: false,
    mode: prior.mode,
    reason: `prior decision mode=${prior.mode} — no assessment evidence (allowed: ${allowedModes.join(",")}), skipping caller scoring`,
  };
}
