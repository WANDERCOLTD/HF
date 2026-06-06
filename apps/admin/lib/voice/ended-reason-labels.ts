/**
 * Friendly-string mapper for `Call.voiceEndedReason` (#1178).
 *
 * VAPI emits raw `endedReason` strings like
 * `pipeline-error-openai-llm-failed`. The Call detail UI maps these to
 * operator-readable explanations. Unmapped reasons fall through to the
 * raw value and emit a one-shot console.warn so the table can be
 * extended next time we see one.
 *
 * Pure function. Safe to call from server components and client code.
 */

const FRIENDLY: Record<string, string> = {
  // VAPI pipeline errors — most common diagnostic class
  "pipeline-error-openai-llm-failed":
    "OpenAI LLM call failed — check VAPI's OpenAI provider key (or switch to HF's custom-llm proxy)",
  "pipeline-error-anthropic-llm-failed":
    "Anthropic LLM call failed — check VAPI's Anthropic provider key",
  "pipeline-error-azure-openai-llm-failed":
    "Azure OpenAI LLM call failed — check VAPI's Azure provider key",
  "pipeline-error-google-llm-failed":
    "Google LLM call failed — check VAPI's Google provider key",
  "pipeline-error-custom-llm-failed":
    "HF's custom-llm proxy returned an error — check the HF dev log",

  // Normal terminations
  "customer-ended-call": "Caller hung up",
  "assistant-ended-call":
    "Assistant ended the call (end-call phrase or tool)",
  "customer-did-not-answer": "Caller didn't answer",
  "customer-busy": "Caller was busy",

  // VAPI-side hangups
  "silence-timed-out":
    "Caller silent past silenceTimeoutSeconds — VAPI hung up",
  "voicemail-detected":
    "VAPI detected voicemail and hung up (toggle off in voice settings if undesired)",
  "exceeded-max-duration":
    "Call exceeded maxDurationSeconds budget",

  // HF-internal sentinel (#1178 poll fallback)
  vapi_poll_failed:
    "Call status couldn't be retrieved from VAPI — externalId may be stale or apiKey wrong",
};

let unmappedSeen = new Set<string>();

/**
 * Returns the friendly label for an endedReason. Logs a one-shot warn
 * for new (unmapped) values so the table can be extended.
 */
export function friendlyEndedReason(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  if (FRIENDLY[raw]) return FRIENDLY[raw];
  if (!unmappedSeen.has(raw)) {
    unmappedSeen.add(raw);
    console.warn(
      `[voice/ended-reason-labels] Unmapped endedReason: "${raw}". Add to FRIENDLY map in lib/voice/ended-reason-labels.ts`,
    );
  }
  return raw;
}

/**
 * Test-only — clears the one-shot-warn set so a vitest can assert the
 * warn fires on first sight of a new unmapped reason.
 */
export function __resetEndedReasonWarnSet(): void {
  unmappedSeen = new Set<string>();
}
