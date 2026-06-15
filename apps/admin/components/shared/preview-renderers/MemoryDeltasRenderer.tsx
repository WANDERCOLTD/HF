"use client";

/**
 * MemoryDeltasRenderer — #1645 (Epic #1606 Group A.5).
 *
 * Inspector sticky for the `memoryDeltas` composer section (loader +
 * transform shipped in #1644 / #1653). Surfaces the CallerMemory diff
 * between the most-recent prior call and its predecessor (via
 * `Call.previousCallId`) so the educator can see what's "newly known"
 * or "updated" about the learner heading into the next call.
 *
 * Sibling shape to `ConversationArtifactsRenderer` — same loading +
 * no-learner + Call 1 + empty + populated states, but the populated
 * block distinguishes ADDED rows (full chip) from UPDATED rows
 * (chip + diff arrow showing prior → new value).
 *
 * Read-only by design (epic #1675 Slice B note): memory deltas are
 * computed from CallerMemory diffs, not educator settings. This
 * renderer remains a read-only display.
 */

import { registerPreviewRenderer } from "@/components/shared/designer-shell/section-registry";
import type { PreviewRendererProps } from "@/components/shared/designer-shell/section-registry";

export interface MemoryDeltaAddedEntry {
  category: string;
  key: string;
  value: string;
  confidence: number;
}

export interface MemoryDeltaUpdatedEntry {
  category: string;
  key: string;
  value: string;
  priorValue: string;
  confidence: number;
}

export interface MemoryDeltasRendererData {
  loading?: boolean;
  /** Caller chosen for preview ("most-recent active learner on this course"). Null when no callers enrolled yet. */
  previewCallerName?: string | null;
  hasDeltas: boolean;
  priorCallId: string | null;
  priorPriorCallId: string | null;
  added: MemoryDeltaAddedEntry[];
  updated: MemoryDeltaUpdatedEntry[];
}

export function MemoryDeltasRenderer({
  data,
}: PreviewRendererProps<MemoryDeltasRendererData>) {
  if (data.loading) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">Memory deltas</div>
        <span className="hf-badge hf-badge-muted">
          Loading recent memory changes…
        </span>
      </div>
    );
  }

  if (data.previewCallerName === null) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">Memory deltas</div>
        <span className="hf-badge hf-badge-muted">
          No learners enrolled yet
        </span>
      </div>
    );
  }

  const callerPrefix = data.previewCallerName
    ? ` (${data.previewCallerName})`
    : "";

  if (!data.hasDeltas) {
    if (!data.priorCallId) {
      return (
        <div className="hf-card-compact">
          <div className="hf-category-label">
            Memory deltas{callerPrefix}
          </div>
          <span className="hf-badge hf-badge-muted">
            No prior call yet — Call 1 path
          </span>
        </div>
      );
    }
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">
          Memory deltas{callerPrefix}
        </div>
        <span className="hf-badge hf-badge-muted">
          No memory changes since last call
        </span>
      </div>
    );
  }

  return (
    <div className="hf-card-compact">
      <div className="hf-category-label">
        Memory deltas{callerPrefix} — {data.added.length} added,{" "}
        {data.updated.length} updated
      </div>
      {data.added.length > 0 && (
        <ol className="hf-list-row">
          {data.added.map((entry) => (
            <li key={`added-${entry.key}`}>
              <span className="hf-badge hf-badge-success">added</span>{" "}
              <span className="hf-category-label">{entry.category}</span>{" "}
              <strong>{entry.key}</strong>
              <div className="hf-text-sm">{entry.value}</div>
            </li>
          ))}
        </ol>
      )}
      {data.updated.length > 0 && (
        <ol className="hf-list-row">
          {data.updated.map((entry) => (
            <li key={`updated-${entry.key}`}>
              <span className="hf-badge hf-badge-warning">updated</span>{" "}
              <span className="hf-category-label">{entry.category}</span>{" "}
              <strong>{entry.key}</strong>
              <div className="hf-text-sm hf-text-muted">
                {entry.priorValue} → <span className="hf-text-strong">{entry.value}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

registerPreviewRenderer<"memoryDeltas", MemoryDeltasRendererData>(
  "memoryDeltas",
  MemoryDeltasRenderer,
);
