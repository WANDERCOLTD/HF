/**
 * Speech-assessment provider abstraction (#1118).
 *
 * Parallel pattern to VoiceProvider but for SCORING vendors (SpeechAce,
 * SpeechSuper) — vendors that take an uploaded audio buffer and return
 * pronunciation / fluency / IELTS scores. Architecture rationale:
 * docs-memory/project_voice_chain_contracts_boundary.md.
 *
 * The interface is upload-only: both known vendors require multipart
 * file upload and neither offers a URL-fetch endpoint. The forthcoming
 * PROSODY pipeline stage (#1119) will `fetch(Call.stereoRecordingUrl)`
 * to obtain a Buffer, then call `scoreUploadedAudio`. A URL-fetch
 * method can be added the day a real URL-fetch vendor is on the roadmap.
 */

import type { ProviderConfigSchema } from "@/lib/voice/types";

export interface SpeechAssessmentCapabilities {
  /** Vendor returns IELTS band scores (0.0–9.0). */
  ieltsSupported: boolean;
  /** Vendor scores unscripted / long-turn audio. */
  spontaneousSupported: boolean;
  /** Vendor scores read-aloud / prompted audio. */
  scriptedSupported: boolean;
  /** Vendor downloads the audio itself given a URL (none today). */
  acceptsRecordingUrl: boolean;
  /** Vendor requires HF to upload the audio bytes (both known vendors). */
  requiresFileUpload: boolean;
  /** Vendor returns a transcript alongside the scores. */
  transcriptIncluded: boolean;
  /** Vendor returns word-level pronunciation diagnostics. */
  perWordDiagnostics: boolean;
  /** Vendor surfaces pace / rhythm / stress prosody features. */
  prosodyFeatures: boolean;
}

/**
 * Vendor-agnostic score envelope emitted by every adapter. The PROSODY
 * pipeline stage (#1119) consumes this shape — the raw vendor payload
 * is kept in `raw` for forensic / audit but never read in shared code.
 */
export interface NormalisedScoreResult {
  ielts?: {
    /** Combined IELTS band 0.0–9.0. */
    overall: number;
    pronunciation: number;
    fluency: number;
    grammar?: number;
    vocabulary?: number;
    coherence?: number;
  };
  transcript?: string;
  /** Vendor-specific word / phoneme detail (shape varies by vendor). */
  diagnostics?: unknown;
  /** Verbatim vendor response — never inspected in shared code. */
  raw: unknown;
}

export type ScoringMode = "ielts" | "general";

export interface SpeechAssessmentAdapter {
  readonly slug: string;
  getCapabilities(): SpeechAssessmentCapabilities;
  getConfigSchema(): ProviderConfigSchema;

  /**
   * Score an uploaded audio buffer. REQUIRED on every adapter.
   *
   * Both known vendors (SpeechAce v9, SpeechSuper) require multipart
   * file upload and neither offers a URL-fetch endpoint, so the
   * interface is upload-only at this stage.
   *
   * - `buffer` — raw audio bytes. Adapter is responsible for any
   *   re-encoding the vendor requires (e.g. SpeechSuper expects
   *   16-bit / 16kHz / mono).
   * - `mimeType` — `audio/wav` / `audio/mpeg` / `audio/ogg` etc. The
   *   adapter maps this onto the vendor's expected `audioType`.
   * - `mode` — `"ielts"` enables IELTS band rubric scoring; `"general"`
   *   asks the vendor for generic prosody / pronunciation features.
   *   Adapters that don't support a mode should throw a clear error.
   *
   * Returns a `NormalisedScoreResult`. Throws on vendor 4xx/5xx — the
   * PROSODY stage catches and emits a `mode: "unavailable"` contract.
   */
  scoreUploadedAudio(
    buffer: Buffer,
    mimeType: string,
    mode: ScoringMode,
  ): Promise<NormalisedScoreResult>;
}

export interface SpeechAssessmentAdapterConstructor {
  new (
    credentials: Record<string, unknown>,
    config: Record<string, unknown>,
  ): SpeechAssessmentAdapter;
}
