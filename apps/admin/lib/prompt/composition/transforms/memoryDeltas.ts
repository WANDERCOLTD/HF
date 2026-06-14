/**
 * memoryDeltas transform (#1644 — Epic #1606 Group A.5).
 *
 * Shape mapper for the loader output. Returns `null` when the diff is
 * empty so the section's `fallback: "omit"` drops it from the emitted
 * prompt (Call 1 + identical-memory-sets paths collapse to the same
 * empty state).
 *
 * Sibling shape to `renderConversationArtifacts` — both sections live at
 * priority 7.7–7.75 and read caller-scoped per-call state.
 */

import { registerTransform } from "../TransformRegistry";
import type { MemoryDeltasData } from "../loaders/memoryDeltas";

export interface MemoryDeltasSection {
  hasDeltas: true;
  priorCallId: string;
  addedCount: number;
  updatedCount: number;
  added: Array<{
    category: string;
    key: string;
    value: string;
    confidence: number;
  }>;
  updated: Array<{
    category: string;
    key: string;
    value: string;
    priorValue: string;
    confidence: number;
  }>;
  summary: string;
}

registerTransform("renderMemoryDeltas", (rawData: MemoryDeltasData) => {
  if (!rawData || !rawData.hasDeltas) return null;
  if (rawData.added.length === 0 && rawData.updated.length === 0) return null;

  const addedCount = rawData.added.length;
  const updatedCount = rawData.updated.length;

  const parts: string[] = [];
  if (addedCount > 0) {
    parts.push(`${addedCount} new fact${addedCount === 1 ? "" : "s"}`);
  }
  if (updatedCount > 0) {
    parts.push(`${updatedCount} updated`);
  }
  const summary = `Since your last call: ${parts.join(", ")}.`;

  const section: MemoryDeltasSection = {
    hasDeltas: true,
    priorCallId: rawData.priorCallId!,
    addedCount,
    updatedCount,
    added: rawData.added.map((a) => ({
      category: a.category,
      key: a.key,
      value: a.value,
      confidence: a.confidence,
    })),
    updated: rawData.updated.map((u) => ({
      category: u.category,
      key: u.key,
      value: u.value,
      priorValue: u.priorValue ?? "",
      confidence: u.confidence,
    })),
    summary,
  };
  return section;
});
