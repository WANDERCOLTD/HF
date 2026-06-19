/**
 * Memories response redactor — #1922 (epic #1915, §6a I-PR7).
 *
 * Strips operator-only fields from `/api/callers/[callerId]/memories`
 * for STUDENT / VIEWER / TESTER tier.
 *
 * **What gets hidden at the `redacted` tier (per MemoryEntry):**
 * - `confidence` (numeric internal)
 * - `evidence` (raw transcript excerpt — operator-facing forensics)
 * - `decayFactor` (numeric internal, signals stale memory pruning)
 *
 * **What stays visible at the `redacted` tier:**
 * - `id`, `category`, `key`, `value`, `extractedAt` — the learner can
 *   legitimately see what the AI remembered about them (the value).
 *   Evidence excerpt is operator-only because it may include in-call
 *   text the learner doesn't expect to be re-quoted to them.
 * - Summary counts — aggregate, no per-memory leakage.
 */

import type { VisibilityTier } from "@/lib/rbac/visibility";
import type {
  MemoriesResponse,
  MemoryEntry,
  MemorySummaryEntry,
} from "@/app/api/callers/[callerId]/memories/route";

export interface MemoryEntryRedacted {
  id: string;
  category: string;
  key: string;
  value: string;
  extractedAt: string | null;
}

export interface MemoriesResponseRedacted {
  ok: boolean;
  callerId: string;
  memories: MemoryEntryRedacted[];
  summary: MemorySummaryEntry;
  viewerTier: "redacted";
}

export interface MemoriesResponseFull extends MemoriesResponse {
  viewerTier: "full" | "diagnostic";
}

export type MemoriesResponseForViewer =
  | MemoriesResponseRedacted
  | MemoriesResponseFull;

function redactMemory(m: MemoryEntry): MemoryEntryRedacted {
  return {
    id: m.id,
    category: m.category,
    key: m.key,
    value: m.value,
    extractedAt: m.extractedAt,
  };
}

export function redactMemoriesForTier(
  raw: MemoriesResponse,
  tier: VisibilityTier,
): MemoriesResponseForViewer {
  if (tier === "full" || tier === "diagnostic") {
    return { ...raw, viewerTier: tier };
  }
  return {
    ok: raw.ok,
    callerId: raw.callerId,
    memories: raw.memories.map(redactMemory),
    summary: raw.summary,
    viewerTier: "redacted",
  };
}
