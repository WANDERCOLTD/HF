"use client";

/**
 * IntakeRenderer — Group B.13 (Epic #1606).
 *
 * Shows enabled/disabled state of the four intake questions:
 *   - Goals
 *   - About you
 *   - Knowledge check (with delivery mode: MCQ / Socratic)
 *   - AI intro call
 *
 * Section: `intake` (kind: "runtime" config-sourced — reads from
 * `Playbook.config.intake` via the session-flow resolver).
 */

import { registerPreviewRenderer } from "@/components/shared/designer-shell/section-registry";
import type { PreviewRendererProps } from "@/components/shared/designer-shell/section-registry";

import type { SessionFlowData } from "./types";

export interface IntakeRendererData {
  sessionFlow: SessionFlowData | null;
}

function StateChip({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span
      className={`hf-badge ${enabled ? "hf-badge-info" : "hf-badge-muted"}`}
    >
      {label}: {enabled ? "ON" : "OFF"}
    </span>
  );
}

export function IntakeRenderer({
  data,
}: PreviewRendererProps<IntakeRendererData>) {
  const sf = data.sessionFlow;
  if (!sf) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">Intake</div>
        <span className="hf-badge hf-badge-muted">Session flow not loaded</span>
      </div>
    );
  }
  const kcMode = sf.intake.knowledgeCheck.deliveryMode ?? "mcq";
  return (
    <div className="hf-card-compact">
      <div className="hf-category-label">Intake — pre-call questions</div>
      <StateChip enabled={sf.intake.goals.enabled} label="Goals" />
      <StateChip enabled={sf.intake.aboutYou.enabled} label="About you" />
      <StateChip
        enabled={sf.intake.knowledgeCheck.enabled}
        label={`Knowledge check (${kcMode === "socratic" ? "Socratic" : "MCQ"})`}
      />
      <StateChip enabled={sf.intake.aiIntroCall.enabled} label="AI intro call" />
      {sf.source?.intake ? (
        <span className="hf-badge hf-badge-muted">
          source: {sf.source.intake}
        </span>
      ) : null}
    </div>
  );
}

registerPreviewRenderer<"intake", IntakeRendererData>("intake", IntakeRenderer);
