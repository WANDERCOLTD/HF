/**
 * Capability-based orchestrator branching for the VP-neutral surface
 * (#1908).
 *
 * Replaces ad-hoc `provider.slug === "vapi"` branches with explicit
 * capability checks. When a code path needs a capability the active VP
 * doesn't declare, the helper throws a clear error pointing at which
 * adapter needs work — much louder than a silent fall-through.
 *
 * Boolean-only capabilities are the safe surface for `requireCapability`;
 * structural capabilities like `endOfCallEvents: "single" | "split"` are
 * branched directly at call sites.
 */

import type { VoiceProvider, VoiceProviderCapabilities } from "./types";

/** Boolean-typed capability keys (the subset safe for require-or-throw). */
export type BooleanCapability =
  | "hasKnowledgeCallback"
  | "toolCallsOverWebSocket"
  | "supportsRequestEndCall"
  | "supportsProactiveSpeech"
  | "supportsCustomLLMProxy"
  | "supportsInBandSystemMessage"
  | "supportsHandoff";

/**
 * Throw when the provider does not declare support for the named
 * capability. Use at orchestrator branch points where the calling code
 * structurally depends on the capability — the error names BOTH the
 * provider slug and the capability so the next operator knows exactly
 * which adapter to extend.
 *
 * @param provider — The voice provider being asked.
 * @param capability — Capability key (boolean-typed).
 * @param reason — Short string explaining why the caller needs this
 *   capability. Surfaces in the error message + telemetry.
 *
 * @throws Error when capability is not declared.
 */
export function requireCapability(
  provider: VoiceProvider,
  capability: BooleanCapability,
  reason: string,
): void {
  const caps = provider.getCapabilities();
  if (!caps[capability]) {
    throw new Error(
      `[voice/require-capability] provider '${provider.slug}' does not support '${capability}' — ${reason}`,
    );
  }
}

/**
 * Non-throwing variant — returns whether the provider declares the
 * capability. Use when the calling code has a graceful fallback.
 */
export function hasCapability(
  provider: VoiceProvider,
  capability: BooleanCapability,
): boolean {
  return Boolean(provider.getCapabilities()[capability]);
}

/**
 * Pure helper for the same check against an already-resolved
 * capabilities object — useful in code paths that resolve capabilities
 * once and dispatch many times.
 */
export function capabilitiesAllow(
  capabilities: VoiceProviderCapabilities,
  capability: BooleanCapability,
): boolean {
  return Boolean(capabilities[capability]);
}
