/**
 * Shared types for the Preview renderers (Epic #1606).
 *
 * Mirrors the `SessionFlowResp` shape served by
 * `GET /api/courses/:id/session-flow`. Extracted here so renderer
 * modules don't depend on `PreviewLens.tsx` internals — keeps the
 * registry decoupled from the canvas component.
 */

export interface SessionFlowData {
  intake: {
    goals: { enabled: boolean };
    aboutYou: { enabled: boolean };
    knowledgeCheck: {
      enabled: boolean;
      deliveryMode?: "mcq" | "socratic";
    };
    aiIntroCall: { enabled: boolean };
  };
  onboarding: {
    phases: Array<{ phase: string; duration?: string; goals?: string[] }>;
  };
  welcomeMessage: string | null;
  firstCallCourseIntro: string | null;
  firstCallWaitForAck: "none" | "any_response" | "greeting_words";
  offboarding: {
    phases: Array<{ phase: string }>;
    triggerAfterCalls?: number;
  };
  stops: Array<{
    id: string;
    kind: string;
    trigger?: { type: string; threshold?: number; count?: number };
  }>;
  source?: {
    intake?: "new-shape" | "legacy-welcome" | "defaults";
    onboarding?: "new-shape" | "playbook-legacy" | "domain" | "init001";
    stops?: "new-shape" | "synthesized-from-legacy";
    offboarding?: "new-shape" | "playbook-legacy" | "defaults";
    welcomeMessage?: "playbook" | "domain" | "generic";
    firstCallCourseIntro?: "playbook" | "none";
    firstCallWaitForAck?: "playbook" | "default";
  };
}
