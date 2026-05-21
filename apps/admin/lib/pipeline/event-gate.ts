import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
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
 * Returns true when:
 *   1. `EVIDENCE_FIRST_SCORING_ENABLED` env flag is "true" AND
 *   2. EITHER `playbookId` is in `evidence-first-playbooks.json` (legacy
 *      list, kept for back-compat) OR the supplied `playbookConfig` carries
 *      `scoringMode === "evidence-first"` (#UI-followup Gap 1 — declared
 *      via the course-ref front-matter `hf-scoring-mode: evidence-first`).
 *
 * The async variant `isEvidenceFirstPlaybookAsync()` resolves the config
 * automatically when only an ID is available. Use the sync overload when
 * you already have the playbook config in hand (saves a query).
 */
export function isEvidenceFirstPlaybook(
  playbookId: string | null | undefined,
  playbookConfig?: Record<string, unknown> | null,
): boolean {
  if (!playbookId) return false;
  if (!config.scheduler.evidenceFirstEnabled) return false;
  if (config.scheduler.evidenceFirstPlaybooks.includes(playbookId)) return true;
  if (playbookConfig && (playbookConfig as { scoringMode?: string }).scoringMode === "evidence-first") {
    return true;
  }
  return false;
}

/**
 * Async helper that fetches Playbook.config to honour the front-matter
 * declaration. Use this in code paths that have a playbookId but not the
 * config object already; otherwise pass the config to the sync overload.
 */
export async function isEvidenceFirstPlaybookAsync(
  playbookId: string | null | undefined,
): Promise<boolean> {
  if (!playbookId) return false;
  if (!config.scheduler.evidenceFirstEnabled) return false;
  if (config.scheduler.evidenceFirstPlaybooks.includes(playbookId)) return true;
  try {
    const pb = await prisma.playbook.findUnique({
      where: { id: playbookId },
      select: { config: true },
    });
    const cfg = (pb?.config ?? {}) as Record<string, unknown>;
    return cfg.scoringMode === "evidence-first";
  } catch {
    return false;
  }
}

export async function shouldRunCallerAnalysis(
  callerId: string,
  playbookId?: string | null,
): Promise<EventGateResult> {
  // #566 Step 3 + #UI-followup Gap 1 — evidence-first override.
  // Honours BOTH the legacy hardcoded ID list AND
  // `Playbook.config.scoringMode === "evidence-first"` set via the
  // course-ref front-matter declaration.
  if (await isEvidenceFirstPlaybookAsync(playbookId)) {
    return {
      allow: true,
      mode: "evidence-first",
      reason: `playbook ${playbookId} is evidence-first scored — per-parameter decisions delegated to scorer (hasLearnerEvidence) and pre-filter`,
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
