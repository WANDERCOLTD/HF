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
  const sf = data.sessionFlow;
  if (!sf) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">Greeting</div>
        <span className="hf-badge hf-badge-muted">Session flow not loaded</span>
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
