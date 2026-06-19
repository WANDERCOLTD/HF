/**
 * LO-mastery response redactor — #1922 (epic #1915, §6a I-PR7).
 *
 * Strips operator-only numeric internals from
 * `/api/callers/[callerId]/lo-mastery` for STUDENT / VIEWER / TESTER tier.
 *
 * **What gets hidden at the `redacted` tier (per LoMasteryEntry):**
 * - `mastery` (raw 0–1 ratchet) — collapsed into a coarse `status` only
 * - `tier` (resolved band string)
 * - `bandLabel` (numeric band id)
 * - `masteryThreshold` (per-LO criterion — internal threshold)
 *
 * **What stays visible at the `redacted` tier:**
 * - `ref`, `description`, `status` (not_started / in_progress / mastered),
 *   `updatedAt`
 * - Identity envelope (callerId, playbookId, moduleId, moduleSlug,
 *   moduleTitle, useFreshMastery, scratchSourceCallId)
 */

import type { VisibilityTier } from "@/lib/rbac/visibility";
import type {
  LoMasteryResponse,
  LoMasteryEntry,
} from "@/app/api/callers/[callerId]/lo-mastery/route";

export interface LoMasteryEntryRedacted {
  ref: string;
  description: string;
  status: LoMasteryEntry["status"];
  updatedAt: string | null;
}

export interface LoMasteryResponseRedacted {
  callerId: string;
  playbookId: string | null;
  moduleId: string;
  moduleSlug: string;
  moduleTitle: string;
  useFreshMastery: boolean;
  scratchSourceCallId: string | null;
  learningObjectives: LoMasteryEntryRedacted[];
  viewerTier: "redacted";
}

export interface LoMasteryResponseFull extends LoMasteryResponse {
  viewerTier: "full" | "diagnostic";
}

export type LoMasteryResponseForViewer =
  | LoMasteryResponseRedacted
  | LoMasteryResponseFull;

function redactEntry(e: LoMasteryEntry): LoMasteryEntryRedacted {
  return {
    ref: e.ref,
    description: e.description,
    status: e.status,
    updatedAt: e.updatedAt,
  };
}

export function redactLoMasteryForTier(
  raw: LoMasteryResponse,
  tier: VisibilityTier,
): LoMasteryResponseForViewer {
  if (tier === "full" || tier === "diagnostic") {
    return { ...raw, viewerTier: tier };
  }
  return {
    callerId: raw.callerId,
    playbookId: raw.playbookId,
    moduleId: raw.moduleId,
    moduleSlug: raw.moduleSlug,
    moduleTitle: raw.moduleTitle,
    useFreshMastery: raw.useFreshMastery,
    scratchSourceCallId: raw.scratchSourceCallId,
    learningObjectives: raw.learningObjectives.map(redactEntry),
    viewerTier: "redacted",
  };
}
