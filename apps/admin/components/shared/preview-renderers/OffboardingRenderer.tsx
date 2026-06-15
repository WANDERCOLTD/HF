"use client";

/**
 * OffboardingRenderer — Group B.13 (Epic #1606).
 *
 * Shows end-of-course offboarding phases + the call-count trigger.
 *
 * Section: `offboarding` (kind: "runtime" config-sourced).
 *
 * Editability deferred to Phase 3 of epic #1675: the offboardingFlowPhases
 * setting uses the `phases` compound control, which Phase 1 ships as a
 * placeholder. Phase 3 unlocks inline editing here. Until then this
 * renderer stays read-only regardless of provider context.
 */

import { registerPreviewRenderer } from "@/components/shared/designer-shell/section-registry";
import type { PreviewRendererProps } from "@/components/shared/designer-shell/section-registry";

import type { SessionFlowData } from "./types";

export interface OffboardingRendererData {
  sessionFlow: SessionFlowData | null;
}

export function OffboardingRenderer({
  data,
}: PreviewRendererProps<OffboardingRendererData>) {
  const sf = data.sessionFlow;
  if (!sf) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">Offboarding</div>
        <span className="hf-badge hf-badge-muted">Session flow not loaded</span>
      </div>
    );
  }
  const phases = sf.offboarding.phases;
  return (
    <div className="hf-card-compact">
      <div className="hf-category-label">
        Offboarding — end-of-course phases ({phases.length})
      </div>
      {phases.length === 0 ? (
        <span className="hf-badge hf-badge-muted">
          No phases configured
        </span>
      ) : (
        <ol className="hf-list-row">
          {phases.map((p, i) => (
            <li key={`${p.phase}-${i}`}>
              <span className="hf-badge hf-badge-info">{p.phase}</span>
            </li>
          ))}
        </ol>
      )}
      {typeof sf.offboarding.triggerAfterCalls === "number" ? (
        <>
          <div className="hf-category-label">Trigger</div>
          <span className="hf-badge hf-badge-info">
            After {sf.offboarding.triggerAfterCalls} call
            {sf.offboarding.triggerAfterCalls === 1 ? "" : "s"}
          </span>
        </>
      ) : null}
      {sf.source?.offboarding ? (
        <span className="hf-badge hf-badge-muted">
          source: {sf.source.offboarding}
        </span>
      ) : null}
    </div>
  );
}

registerPreviewRenderer<"offboarding", OffboardingRendererData>(
  "offboarding",
  OffboardingRenderer,
);
