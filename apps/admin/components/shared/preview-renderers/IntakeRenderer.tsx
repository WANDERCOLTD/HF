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
import { JourneyField } from "@/components/journey-controls";
import { JOURNEY_SETTINGS_BY_ID } from "@/lib/journey/setting-contracts.entries";

import { useJourneySetting } from "./_journey-setting-context";
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
  const ctx = useJourneySetting();
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

  if (ctx.courseId && !ctx.readonly) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">Intake — pre-call questions</div>
        {(["intakeKnowledgeCheck", "intakeAboutYou"] as const).map((id) => {
          const c = JOURNEY_SETTINGS_BY_ID[id];
          if (!c) return null;
          const v =
            id === "intakeKnowledgeCheck"
              ? sf.intake.knowledgeCheck.enabled
              : sf.intake.aboutYou.enabled;
          return (
            <JourneyField
              key={id}
              contract={c}
              value={v}
              onSave={(next) => ctx.saveSetting(id, next)}
            />
          );
        })}
        <div className="hf-category-label">Read-only (settings without editable mode yet)</div>
        <StateChip enabled={sf.intake.goals.enabled} label="Goals" />
        <StateChip enabled={sf.intake.aiIntroCall.enabled} label="AI intro call" />
        {sf.source?.intake ? (
          <span className="hf-badge hf-badge-muted">
            source: {sf.source.intake} · KC mode: {kcMode === "socratic" ? "Socratic" : "MCQ"}
          </span>
        ) : null}
      </div>
    );
  }

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
