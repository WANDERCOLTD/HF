"use client";

/**
 * WelcomeRenderer — Group B.13 (Epic #1606) sibling of FirstCallModeRenderer.
 *
 * Shows the live greeting state from `GET /api/courses/:id/session-flow`:
 *   - Resolved welcome message (chip badge: PLAYBOOK / DOMAIN / GENERIC source)
 *   - Wait-for-ack mode (none / any response / greeting words)
 *   - Course-intro presence (chip + excerpt when authored)
 *
 * Section: `welcome` (kind: "runtime" config-sourced — no compose-time
 * loader; reads `Playbook.config` via the session-flow resolver).
 */

import { registerPreviewRenderer } from "@/components/shared/designer-shell/section-registry";
import type { PreviewRendererProps } from "@/components/shared/designer-shell/section-registry";
import { JourneyField } from "@/components/journey-controls";
import { JOURNEY_SETTINGS_BY_ID } from "@/lib/journey/setting-contracts.entries";

import { useJourneySetting } from "./_journey-setting-context";
import type { SessionFlowData } from "./types";

export interface WelcomeRendererData {
  sessionFlow: SessionFlowData | null;
}

const ACK_LABEL: Record<SessionFlowData["firstCallWaitForAck"], string> = {
  none: "No acknowledgement gate",
  any_response: "Waits for any reply",
  greeting_words: "Waits for hi / hello / yes / …",
};

const SOURCE_LABEL: Record<NonNullable<SessionFlowData["source"]>["welcomeMessage"] & string, string> = {
  playbook: "PLAYBOOK",
  domain: "DOMAIN",
  generic: "GENERIC",
};

export function WelcomeRenderer({
  data,
}: PreviewRendererProps<WelcomeRendererData>) {
  const ctx = useJourneySetting();
  const sf = data.sessionFlow;
  if (!sf) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">Greeting</div>
        <span className="hf-badge hf-badge-muted">Session flow not loaded</span>
      </div>
    );
  }

  // Editable branch — mount JourneyField for welcomeMessage. Other
  // settings (ack mode, course intro) ship in a sibling commit; for now
  // they fall back to the read-only display below the editable field.
  if (ctx.courseId && !ctx.readonly) {
    const welcomeContract = JOURNEY_SETTINGS_BY_ID.welcomeMessage;
    return (
      <div className="hf-card-compact">
        {welcomeContract ? (
          <JourneyField
            contract={welcomeContract}
            value={sf.welcomeMessage ?? ""}
            onSave={(v) => ctx.saveSetting("welcomeMessage", v)}
          />
        ) : null}
        <div className="hf-category-label">Ack gate</div>
        <span className="hf-badge hf-badge-info">
          {ACK_LABEL[sf.firstCallWaitForAck]}
        </span>
        {sf.firstCallCourseIntro ? (
          <>
            <div className="hf-category-label">Course intro</div>
            <p className="hf-text-sm">{sf.firstCallCourseIntro}</p>
          </>
        ) : null}
      </div>
    );
  }

  const welcomeSource = sf.source?.welcomeMessage;
  return (
    <div className="hf-card-compact">
      <div className="hf-category-label">Greeting</div>
      {sf.welcomeMessage ? (
        <>
          <span className="hf-badge hf-badge-info">Welcome set</span>
          {welcomeSource ? (
            <span className="hf-badge hf-badge-muted">
              from {SOURCE_LABEL[welcomeSource]}
            </span>
          ) : null}
          <p className="hf-text-sm">{sf.welcomeMessage}</p>
        </>
      ) : (
        <span className="hf-badge hf-badge-muted">Using generic fallback</span>
      )}
      <div className="hf-category-label">Ack gate</div>
      <span className="hf-badge hf-badge-info">
        {ACK_LABEL[sf.firstCallWaitForAck]}
      </span>
      {sf.firstCallCourseIntro ? (
        <>
          <div className="hf-category-label">Course intro</div>
          <span className="hf-badge hf-badge-info">Authored</span>
          <p className="hf-text-sm">{sf.firstCallCourseIntro}</p>
        </>
      ) : null}
    </div>
  );
}

registerPreviewRenderer<"welcome", WelcomeRendererData>(
  "welcome",
  WelcomeRenderer,
);
