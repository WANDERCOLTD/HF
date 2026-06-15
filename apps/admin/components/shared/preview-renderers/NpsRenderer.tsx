"use client";

/**
 * NpsRenderer — Group B.13 (Epic #1606).
 *
 * Shows the NPS Session Stop trigger configuration. Locates the `nps`
 * entry inside `sessionFlow.stops[]` and renders a human-readable
 * trigger summary.
 *
 * Section: `nps` (kind: "runtime" config-sourced). Surfaces in
 * PreviewLens via the `stops` sidetray lens; the registry section key
 * is `nps` (the actual stop type).
 *
 * Editability deferred to Phase 3 of epic #1675: npsStop uses the
 * `stop` compound control, which Phase 1 ships as a placeholder.
 * Phase 3 wraps the existing SurveyStopDetail-style editor. Until then
 * this renderer stays read-only regardless of provider context.
 */

import { registerPreviewRenderer } from "@/components/shared/designer-shell/section-registry";
import type { PreviewRendererProps } from "@/components/shared/designer-shell/section-registry";

import type { SessionFlowData } from "./types";

export interface NpsRendererData {
  sessionFlow: SessionFlowData | null;
}

function describeTrigger(t: {
  type: string;
  threshold?: number;
  count?: number;
}): string {
  if (t.type === "mastery_reached" && typeof t.threshold === "number") {
    return `Mastery ≥ ${Math.round(t.threshold * 100)}%`;
  }
  if (t.type === "after_n_calls" && typeof t.count === "number") {
    return `After ${t.count} call${t.count === 1 ? "" : "s"}`;
  }
  if (t.type === "course_end") {
    return "Course end";
  }
  return t.type;
}

export function NpsRenderer({
  data,
}: PreviewRendererProps<NpsRendererData>) {
  const sf = data.sessionFlow;
  if (!sf) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">NPS prompt</div>
        <span className="hf-badge hf-badge-muted">Session flow not loaded</span>
      </div>
    );
  }
  const npsStop = sf.stops.find((s) => s.kind === "nps");
  if (!npsStop) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">NPS prompt</div>
        <span className="hf-badge hf-badge-muted">No NPS stop configured</span>
      </div>
    );
  }
  return (
    <div className="hf-card-compact">
      <div className="hf-category-label">NPS prompt</div>
      <span className="hf-badge hf-badge-info">
        Triggers: {npsStop.trigger ? describeTrigger(npsStop.trigger) : "—"}
      </span>
      {sf.source?.stops ? (
        <span className="hf-badge hf-badge-muted">
          source: {sf.source.stops}
        </span>
      ) : null}
    </div>
  );
}

registerPreviewRenderer<"nps", NpsRendererData>("nps", NpsRenderer);
