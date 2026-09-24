/**
 * Skills-evidence response redactor — #1922 (epic #1915, §6a I-PR7).
 *
 * Strips operator-only fields from `/api/callers/[callerId]/skills-evidence`
 * when admitted under STUDENT / VIEWER / TESTER tier. Pairs with
 * `redactAdaptationsForTier` as the canonical reference.
 *
 * **What gets hidden at the `redacted` tier (per CallerSkillEvidenceItem):**
 * - `reasoning` — free-text rationale
 * - `analysisSpecName` — operator metadata
 * - `evidenceQuality` — numeric internal
 * - `scoredBy` — operator attribution
 * - `confidence` — numeric internal
 *
 * **What stays visible at the `redacted` tier:**
 * - Identity envelope (callerId, playbookId, limit, empty)
 * - Skill rows + parameter names
 * - Evidence items: callId, measuredAt, score, excerpts (learner's own quotes),
 *   hasLearnerEvidence boolean
 * - Segment cells (all fields — segment labels, bands, durations are
 *   learner-relevant)
 *
 * **Whitelist-default-safe:** new fields added to `CallerSkillEvidenceItem`
 * do NOT auto-flow to the redacted tier — this file must be updated.
 */

import type { VisibilityTier } from "@/lib/rbac/visibility";
import type {
  CallerSkillEvidenceResponse,
  CallerSkillEvidenceRow,
  CallerSkillEvidenceItem,
  CallerSkillSegmentCell,
} from "@/app/api/callers/[callerId]/skills-evidence/route";

export interface CallerSkillEvidenceItemRedacted {
  callId: string;
  measuredAt: string;
  score: number;
  excerpts: string[];
  hasLearnerEvidence: boolean | null;
}

export interface CallerSkillEvidenceRowRedacted {
  skillRef: string;
  parameterId: string;
  parameterName: string;
  evidence: CallerSkillEvidenceItemRedacted[];
  segments: CallerSkillSegmentCell[];
}

export interface CallerSkillEvidenceResponseRedacted {
  callerId: string;
  playbookId: string | null;
  limit: number;
  rows: CallerSkillEvidenceRowRedacted[];
  empty: boolean;
  viewerTier: "redacted";
}

export interface CallerSkillEvidenceResponseFull
  extends CallerSkillEvidenceResponse {
  viewerTier: "full" | "diagnostic";
}

export type CallerSkillEvidenceResponseForViewer =
  | CallerSkillEvidenceResponseRedacted
  | CallerSkillEvidenceResponseFull;

function redactItem(
  item: CallerSkillEvidenceItem,
): CallerSkillEvidenceItemRedacted {
  return {
    callId: item.callId,
    measuredAt: item.measuredAt,
    score: item.score,
    excerpts: item.excerpts,
    hasLearnerEvidence: item.hasLearnerEvidence,
  };
}

function redactRow(
  row: CallerSkillEvidenceRow,
): CallerSkillEvidenceRowRedacted {
  return {
    skillRef: row.skillRef,
    parameterId: row.parameterId,
    parameterName: row.parameterName,
    evidence: row.evidence.map(redactItem),
    segments: row.segments,
  };
}

export function redactSkillsEvidenceForTier(
  raw: CallerSkillEvidenceResponse,
  tier: VisibilityTier,
): CallerSkillEvidenceResponseForViewer {
  if (tier === "full" || tier === "diagnostic") {
    return { ...raw, viewerTier: tier };
  }
  return {
    callerId: raw.callerId,
    playbookId: raw.playbookId,
    limit: raw.limit,
    rows: raw.rows.map(redactRow),
    empty: raw.empty,
    viewerTier: "redacted",
  };
}
