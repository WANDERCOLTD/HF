"use client";

/**
 * OnboardingRenderer — Group B.13 (Epic #1606).
 *
 * Shows the configured first-call onboarding phases. Each phase = a
 * row with phase label + optional duration + first goal preview.
 *
 * Section: `onboarding` (kind: "runtime" config-sourced).
 *
 * Editability deferred to Phase 3 of epic #1675: the onboarding setting
 * uses the `phases` compound control, which Phase 1 ships as a
 * documented placeholder. Phase 3 wraps the existing `OnboardingEditor`
 * and unlocks inline editing here. Until then, this renderer stays
 * read-only regardless of the JourneySettingMutatorProvider context.
 */

import { registerPreviewRenderer } from "@/components/shared/designer-shell/section-registry";
import type { PreviewRendererProps } from "@/components/shared/designer-shell/section-registry";

import type { SessionFlowData } from "./types";

export interface OnboardingRendererData {
  sessionFlow: SessionFlowData | null;
}

export function OnboardingRenderer({
  data,
}: PreviewRendererProps<OnboardingRendererData>) {
  const sf = data.sessionFlow;
  if (!sf) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">Onboarding</div>
        <span className="hf-badge hf-badge-muted">Session flow not loaded</span>
      </div>
    );
  }
  const phases = sf.onboarding.phases;
  return (
    <div className="hf-card-compact">
      <div className="hf-category-label">
        Onboarding — first-call phases ({phases.length})
      </div>
      {phases.length === 0 ? (
        <span className="hf-badge hf-badge-muted">
          No phases configured — using fallback
        </span>
      ) : (
        <ol className="hf-list-row">
          {phases.map((p, i) => (
            <li key={`${p.phase}-${i}`}>
              <span className="hf-badge hf-badge-info">{p.phase}</span>
              {p.duration ? (
                <span className="hf-badge hf-badge-muted">{p.duration}</span>
              ) : null}
              {p.goals && p.goals.length > 0 ? (
                <p className="hf-text-sm">{p.goals[0]}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {sf.source?.onboarding ? (
        <span className="hf-badge hf-badge-muted">
          source: {sf.source.onboarding}
        </span>
      ) : null}
    </div>
  );
}

registerPreviewRenderer<"onboarding", OnboardingRendererData>(
  "onboarding",
  OnboardingRenderer,
);
