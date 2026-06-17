/**
 * VOICE_PROSODY_V1 DataContract TypeScript shape (#1119).
 *
 * The seed lives at `docs-archive/bdd-specs/contracts/VOICE_PROSODY_V1.contract.json`;
 * this file is the strongly-typed mirror for code that produces /
 * consumes the contract envelope.
 *
 * Producer: `lib/pipeline/prosody-runner.ts`
 * Consumer: `lib/pipeline/aggregate-runner.ts` (writes CallScore for
 *   `mode==='ielts'`, BehaviorParameter deltas for `mode==='general'`,
 *   skips for `mode==='unavailable'`).
 */

export type VoiceProsodyMode = "ielts" | "general" | "unavailable";

export type VoiceProsodyErrorReason =
  | "no_recording"
  | "vendor_error"
  | "vendor_timeout"
  | "no_provider_configured";

/** IELTS Speaking sub-bands 0.0–9.0. Maps directly onto the 4 existing
 *  IELTS skill parameters (SKILL-AGG-001 EMA pipeline). */
export interface IeltsScores {
  overall: number;
  fluencyCoherence: number;
  pronunciation: number;
  lexicalResource: number;
  grammaticalRange: number;
}

/** Generic voice signals. paceWpm + hesitationRate map onto existing
 *  BehaviorParameter rows (CONV_PACE, pace_indicators). confidenceProxy
 *  is emitted but has no parameter consumer in #1119 — kept on the
 *  envelope for ADAPT / COMPOSE access via the registry. */
export interface GeneralSignals {
  /** Words-per-minute over the scored window. */
  paceWpm: number;
  /** Filler-word + filled-pause ratio (0–1). */
  hesitationRate: number;
  /** Mean energy in dB. */
  meanEnergyDb: number;
  /** Pitch range in Hz over the scored window. */
  pitchRangeHz: number;
  /** Adapter-specific learner-confidence proxy normalised to 0–1. */
  confidenceProxy: number;
}

/**
 * Per-phase sub-envelope written when segmented scoring fires (#1870).
 * Either an IELTS sub-band block, a generic signals block, or an
 * "unavailable" marker for the phase the adapter failed on. Top-level
 * `ieltsScores` / `generalSignals` on the parent envelope are the
 * MEAN aggregate across the successful phases so existing readers
 * (Snapshot v3, AGGREGATE consumer's whole-call branch, Adaptations
 * tab) stay backwards-compat.
 */
export type ProsodyPhaseEnvelope =
  | { mode: "ielts"; ieltsScores: IeltsScores }
  | { mode: "general"; generalSignals: GeneralSignals }
  | { mode: "unavailable"; errorReason: VoiceProsodyErrorReason };

export interface VoiceProsodyFeatures {
  mode: VoiceProsodyMode;
  ieltsScores?: IeltsScores;
  generalSignals?: GeneralSignals;
  /** Present only when mode === "unavailable". */
  errorReason?: VoiceProsodyErrorReason;
  /** Verbatim vendor JSON, kept for forensics; never read in shared code. */
  rawVendor?: unknown;
  /**
   * #1870 — Per-phase score envelopes when the runner ran segmented
   * scoring. Keys are the namespace-prefixed phaseKey (`phase:<name>`)
   * — see [#1872](https://github.com/WANDERCOLTD/HF/issues/1872) for
   * the namespace decision (Option 2 — namespace prefix). When
   * absent, the envelope was produced by whole-call scoring (pre-#1870
   * behaviour) and downstream readers see only the top-level fields.
   */
  bySegment?: Record<string, ProsodyPhaseEnvelope>;
}

export const VOICE_PROSODY_CONTRACT_ID = "VOICE_PROSODY_V1" as const;
