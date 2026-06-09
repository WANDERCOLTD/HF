/**
 * Voice assistant first-line fallback defaults (#1385).
 *
 * The voice adapter builders (`lib/voice/build-assistant-config.ts`,
 * `lib/voice/route-handlers.ts`) need a literal `first_line` to hand to
 * VAPI/Retell when the configurable cascade can't supply one — either
 * because the caller is unknown (no per-caller cascade reachable) OR
 * because no `ComposedPrompt` exists for the resolved playbook yet
 * (the "no active prompt" fallback path).
 *
 * Per `.claude/rules/pipeline-and-prompt.md` MANDATORY rule, behavioural
 * greeting literals do NOT live inline in voice/composition code — they
 * live HERE (`lib/prompt/composition/defaults/`), the allow-listed
 * system-default template home that the `hf-compose/no-hardcoded-greeting-
 * in-composition` ESLint rule explicitly greenlights. The rule blocks
 * any greeting literal returned from a transform or assistant-config
 * builder, forcing it through this module instead.
 *
 * These are NOT educator-tunable in the current cascade. They are the
 * floor — when every configurable layer is silent, the voice call still
 * gets a coherent opening rather than an empty `assistant.firstMessage`
 * (VAPI dead-airs for ~5s when firstMessage is null). Promotion to a
 * config-cascade source (PlaybookConfig.welcome.unknownCaller,
 * VoiceCallSettings.unknownCallerFirstLine, etc.) is tracked separately.
 *
 * Pure functions. Deterministic. No LLM calls. No DB reads.
 */

/** Unknown-caller fallback — used when VAPI dials a phone we haven't
 *  seen before, so no caller / playbook / domain cascade is available.
 *  Asks for the name; the user's response is captured into the next
 *  pipeline run and persisted on `Caller.name`. */
export const UNKNOWN_CALLER_FIRST_LINE =
  "Hello! I don't think we've spoken before. What's your name?";

/** "No active prompt" fallback — used when a known caller is reached
 *  but no `ComposedPrompt` exists for the resolved playbook yet (typical
 *  for a freshly enrolled caller, before the first call has run through
 *  the COMPOSE pipeline stage). Personalised with the caller's name
 *  when available; falls back to a generic greeting otherwise. */
export function noActivePromptFirstLine(
  callerName: string | null | undefined,
): string {
  const namePart = callerName ? ` ${callerName}` : "";
  return `Hi${namePart}! Good to hear from you.`;
}
