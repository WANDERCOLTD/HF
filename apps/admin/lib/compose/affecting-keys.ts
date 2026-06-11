/**
 * COMPOSE-affecting playbook config keys — #826 (Story 2 of EPIC #832).
 *
 * Top-level keys on `Playbook.config` that flow into the composed prompt.
 * A write that changes any of these MUST trigger a
 * `Playbook.composeInputsUpdatedAt` bump so the staleness check in
 * `lib/compose/staleness.ts::isPromptStale` correctly marks downstream
 * `ComposedPrompt` rows as stale.
 *
 * Keys NOT in this list (e.g. `welcome`, `nps`, `skillTierMapping`,
 * `surveys`) are read by the student portal at runtime, not baked into
 * the deterministic ComposedPrompt — they can change without triggering
 * a recompose.
 *
 * Single source of truth — imported by `updatePlaybookConfig` and any
 * test that needs to assert the list. Do NOT inline this list anywhere
 * else; add new keys here and the helper picks them up automatically.
 */
export const COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS = [
  // Felt Progress + Call-1 namespaces (#779 / #780 / #784 / #790)
  "progressNarrative",
  "offboardingSummary",
  "firstSessionTargets",
  "firstCallMode",
  // Session flow + welcome — used by transforms/pedagogy.ts + onboarding loader
  "sessionFlow",
  "welcomeMessage",
  "onboardingFlowPhases",
  // #1403 Greeting lens — read by transforms/quickstart.ts::first_line +
  // greeting_ack_gate. Educator-tuned course intro + ack-gate mode flow
  // into the composed prompt body.
  "firstCallCourseIntro",
  "firstCallWaitForAck",
  // Audience + teaching shape — read by targets.ts + pedagogy.ts
  "audience",
  "teachingMode",
  "lessonPlanMode",
  // Goals + skill banding
  "goals",
  "skillTierMapping",
] as const;

export type ComposeAffectingPlaybookConfigKey =
  (typeof COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS)[number];

/**
 * Returns true when any of the keys in `next` differ from `prev` by deep
 * equality. Used by `updatePlaybookConfig` to decide whether to bump the
 * timestamp.
 *
 * Uses JSON.stringify for deep equality — fast for the shapes we store
 * (no Dates, no functions, no cycles). If a future config key holds
 * such a value, this comparator needs updating.
 */
export function composeAffectingChanged(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): boolean {
  for (const key of COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      return true;
    }
  }
  return false;
}
