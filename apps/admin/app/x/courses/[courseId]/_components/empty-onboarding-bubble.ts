/**
 * Empty-onboarding bubble copy decision (#1418).
 *
 * When the resolved session-flow has zero onboarding phases, the Preview
 * lens needs to distinguish "educator explicitly opted out" from "never
 * configured — INIT-001 is genuinely the runtime path". The pre-#1418
 * code surfaced the same `(falls back to INIT-001 default phases)` copy
 * for both states, which misled educators into re-editing settings they
 * had intentionally cleared.
 *
 * The resolver at `lib/session-flow/resolver.ts::resolveOnboarding`
 * exposes the distinction via its `source` field — this helper maps
 * that field to the right educator-facing copy.
 *
 * Extracted into a pure module so it can be unit-tested without the
 * surrounding Course Design Console scaffolding.
 */

export type OnboardingSource =
  | "new-shape"
  | "playbook-legacy"
  | "domain"
  | "init001"
  | undefined;

export interface EmptyOnboardingBubble {
  caption: string;
  text: string;
  lensLabel: string;
}

export function emptyOnboardingBubble(
  source: OnboardingSource,
): EmptyOnboardingBubble {
  if (source === "new-shape" || source === "playbook-legacy") {
    return {
      caption: "Onboarding explicitly disabled",
      text: "(call 1 goes straight to teaching — no onboarding phases will run)",
      lensLabel: "Edit Onboarding",
    };
  }
  if (source === "domain") {
    return {
      caption: "Using Domain default onboarding",
      text: "(edit at the domain level to add phases — this course has no override)",
      lensLabel: "Add Onboarding phases",
    };
  }
  return {
    caption: "No onboarding phases configured",
    text: "(falls back to INIT-001 default phases)",
    lensLabel: "Add Onboarding phases",
  };
}
