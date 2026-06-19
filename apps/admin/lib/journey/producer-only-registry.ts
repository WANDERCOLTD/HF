/**
 * Producer-only registry — the canonical list of JourneySettingContract
 * ids whose value the educator CAN edit but no runtime consumer reads.
 *
 * Why: a contract can land in the Inspector without a transform / pipeline
 * gate / voice-provider hook actually doing anything with its value.
 * Educators editing those settings see "✓ Saved" + dirty-dot-clears + no
 * runtime effect. The Inspector lies. This module surfaces the gap
 * honestly via a "🚫 Not yet active" badge on the Inspector row + the
 * matching Preview bubble.
 *
 * Single source of truth. The `registry-consumer-coverage.test.ts`
 * Coverage-pillar test imports this same map as its exempt set, so:
 *
 *   - As consumers ship, remove the contract id from this map.
 *   - Then the Coverage ratchet (EXPECTED_EXEMPT_COUNT) ticks down.
 *   - And the badge automatically disappears from the UI.
 *
 * If a new contract is added without a consumer, the author should
 * either land the consumer in the same PR OR register here (forcing
 * a conscious decision to grow the gap).
 *
 * History: replaces the inline REGISTRY_CONSUMER_EXEMPT_PATHS map in
 * `tests/lib/journey/registry-consumer-coverage.test.ts` (Slice 15 of
 * the journey grey-out epic). The previous shape was test-only; this
 * one is runtime-importable so the UI can surface it.
 */

export type ProducerOnlyDestination =
  | "intake"
  | "compose-prompt"
  | "voice-provider"
  | "runtime-gate"
  | "scoring"
  | "voice-stack-pending";

export interface ProducerOnlyEntry {
  /** Where the consumer is expected to land when shipped. Drives the
   *  badge tooltip + the destination breakdown the operator sees in
   *  the audit drawer. */
  destinedFor: ProducerOnlyDestination;
  /** One-line educator-facing note explaining what's missing. Surfaced
   *  in the Inspector badge tooltip. */
  note: string;
}

/** Active producer-only contracts. Edits land in the playbook config
 *  but nothing downstream uses the value. */
export const PRODUCER_ONLY_CONTRACTS: Record<string, ProducerOnlyEntry> = {
  // ── intake gate
  intakeSkipIfReturning: {
    destinedFor: "intake",
    note: "Intake flow doesn't skip returning learners yet.",
  },

  // ── compose-prompt transforms (educator-tunable but no transform reads it)
  // ── voice provider knobs
  interruptSensitivity: {
    destinedFor: "voice-provider",
    note: "Voice-stack consumer pending — should gate VAPI barge-in threshold + voicemail-detection.",
  },

  // ── runtime gates (composeImpact=[] hides them from the Coverage test,
  // but they're runtime-effect settings hiding behind that flag)
};

/** Type-narrowing helper for the UI. */
export function isProducerOnly(settingId: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRODUCER_ONLY_CONTRACTS, settingId);
}

/** Lookup the entry (note + destination) for badge rendering. */
export function getProducerOnlyEntry(settingId: string): ProducerOnlyEntry | undefined {
  return PRODUCER_ONLY_CONTRACTS[settingId];
}

/** Human-readable label per destination — drives the chip text + the
 *  audit-drawer breakdown the operator sees. */
export const PRODUCER_ONLY_DESTINATION_LABEL: Record<ProducerOnlyDestination, string> = {
  intake: "Intake gate",
  "compose-prompt": "Compose transform",
  "voice-provider": "Voice provider",
  "runtime-gate": "Runtime gate",
  scoring: "Scoring pipeline",
  "voice-stack-pending": "Voice stack",
};
