/**
 * SpeechAce v9 adapter (#1118).
 *
 * Wraps the SpeechAce "Score Task" / spontaneous-speech IELTS scoring
 * endpoint. Auth is a single API key passed as the `?key=` query
 * parameter (NOT a header). Audio is uploaded multipart as
 * `user_audio_file`. IELTS scores live under
 * `speech_score.ielts_score.{overall, pronunciation, fluency, grammar,
 * vocab, coherence}` in the v9 response shape.
 *
 * Docs source of truth: https://api-docs.speechace.com (v9). Sample
 * code: https://github.com/speechace/speechace-api-samples.
 *
 * Cost model: per-second of scored audio. Test-connection probe MUST
 * NOT call this endpoint — it invokes `getCapabilities()` only. See
 * `/api/speech-assessment-providers/[id]/test-connection`.
 */

import type { ProviderConfigSchema } from "@/lib/voice/types";
import type {
  NormalisedScoreResult,
  ScoringMode,
  SpeechAssessmentAdapter,
  SpeechAssessmentCapabilities,
} from "@/lib/speech-assessment/types";
import type { GeneralSignals } from "@/lib/pipeline/prosody-types";

/**
 * #1871 — common English filler / hesitation tokens. Used by both the
 * SpeechAce + SpeechSuper general-signal derivers. Kept here as a
 * lower-case Set so callers can `.has(token.toLowerCase())` without
 * re-allocating. The list is intentionally short — false positives ("so",
 * "well") would dominate; only canonical fillers are tracked.
 */
const ENGLISH_FILLER_TOKENS: ReadonlySet<string> = new Set([
  "um", "uh", "umm", "uhh", "uhm", "er", "erm",
  "ah", "ahh", "hmm",
  "like", "y'know", "yknow",
]);

const SPEECHACE_ENDPOINT = "https://api.speechace.co/api/scoring/speech/v9/json";

/** Dialect codes accepted by SpeechAce v9. */
const ALLOWED_DIALECTS = [
  "en-us",
  "en-gb",
  "fr-fr",
  "fr-ca",
  "es-es",
  "es-mx",
] as const;

interface SpeechAceCredentials {
  apiKey?: string;
}

interface SpeechAceConfig {
  dialect?: string;
  /** Optional billing-attribution user identifier passed on every call. */
  userId?: string;
  /** `default` | `strict` — strict mode penalises minor mispronunciations. */
  pronunciationScoreMode?: string;
}

interface SpeechAceIeltsScore {
  overall?: number;
  pronunciation?: number;
  fluency?: number;
  grammar?: number;
  vocab?: number;
  coherence?: number;
}

interface SpeechAceResponse {
  status?: string;
  quota_remaining?: number;
  speech_score?: {
    ielts_score?: SpeechAceIeltsScore;
    transcript?: string;
    word_score_list?: unknown;
  };
}

export class SpeechAceAdapter implements SpeechAssessmentAdapter {
  readonly slug = "speechace";
  private readonly apiKey: string | undefined;
  private readonly dialect: string;
  private readonly userId: string | undefined;
  private readonly pronunciationScoreMode: string | undefined;

  constructor(
    credentials: Record<string, unknown>,
    config: Record<string, unknown>,
  ) {
    const creds = credentials as SpeechAceCredentials;
    const cfg = config as SpeechAceConfig;
    this.apiKey = creds.apiKey;
    this.dialect = cfg.dialect ?? "en-us";
    this.userId = cfg.userId;
    this.pronunciationScoreMode = cfg.pronunciationScoreMode;
  }

  getCapabilities(): SpeechAssessmentCapabilities {
    return {
      ieltsSupported: true,
      spontaneousSupported: true,
      scriptedSupported: false,
      acceptsRecordingUrl: false,
      requiresFileUpload: true,
      transcriptIncluded: true,
      perWordDiagnostics: true,
      prosodyFeatures: false,
    };
  }

  getConfigSchema(): ProviderConfigSchema {
    return {
      fields: [
        {
          key: "apiKey",
          label: "SpeechAce API key",
          type: "string",
          help: 'Single API key issued by SpeechAce. Passed as the `?key=` query parameter on every scoring request. Get one at https://www.speechace.com — sign up gives ~120 minutes free credit for sandbox use.',
          sensitive: true,
          required: true,
        },
        {
          key: "dialect",
          label: "Dialect",
          type: "enum",
          enumValues: [...ALLOWED_DIALECTS],
          default: "en-us",
          help: "Spoken-language dialect SpeechAce will score against. `en-us` / `en-gb` for English IELTS. Adapter falls back to `en-us` when blank.",
        },
        {
          key: "userId",
          label: "User ID (billing attribution)",
          type: "string",
          help: "Optional anonymised identifier passed on every scoring call. SpeechAce uses it to break costs down by end-user in their dashboard. Safe to leave blank for sandbox.",
        },
        {
          key: "pronunciationScoreMode",
          label: "Pronunciation score mode",
          type: "enum",
          enumValues: ["default", "strict"],
          default: "default",
          help: "`default` is lenient — typical for IELTS. `strict` penalises minor phoneme errors — use for diagnostic / accent-training mode.",
        },
      ],
    };
  }

  async scoreUploadedAudio(
    buffer: Buffer,
    mimeType: string,
    mode: ScoringMode,
  ): Promise<NormalisedScoreResult> {
    if (!this.apiKey) {
      throw new Error(
        "SpeechAceAdapter: apiKey is not configured. Set credentials.apiKey on the SpeechAssessmentProvider row.",
      );
    }

    const url = new URL(SPEECHACE_ENDPOINT);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("dialect", this.dialect);
    if (this.userId) {
      url.searchParams.set("user_id", this.userId);
    }

    const form = new FormData();
    form.set(
      "user_audio_file",
      new Blob([new Uint8Array(buffer)], { type: mimeType }),
      filenameForMimeType(mimeType),
    );
    if (mode === "ielts") {
      form.set("include_ielts_feedback", "1");
    }
    if (this.pronunciationScoreMode) {
      form.set("pronunciation_score_mode", this.pronunciationScoreMode);
    }

    const res = await fetch(url.toString(), {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `SpeechAceAdapter: HTTP ${res.status} from scoring endpoint. Body: ${text.slice(0, 300)}`,
      );
    }

    const body = (await res.json()) as SpeechAceResponse;

    if (body.status && body.status !== "success") {
      throw new Error(
        `SpeechAceAdapter: vendor returned status="${body.status}" — scoring rejected.`,
      );
    }

    const ielts = body.speech_score?.ielts_score;
    return {
      ielts: ielts
        ? {
            overall: ielts.overall ?? 0,
            pronunciation: ielts.pronunciation ?? 0,
            fluency: ielts.fluency ?? 0,
            ...(ielts.grammar !== undefined ? { grammar: ielts.grammar } : {}),
            ...(ielts.vocab !== undefined ? { vocabulary: ielts.vocab } : {}),
            ...(ielts.coherence !== undefined
              ? { coherence: ielts.coherence }
              : {}),
          }
        : undefined,
      transcript: body.speech_score?.transcript,
      diagnostics: body.speech_score?.word_score_list,
      raw: body,
    };
  }

  /**
   * #1871 — derive general-mode prosody signals from SpeechAce's standard
   * scoring response. SpeechAce v9 returns `word_score_list[]` with
   * `start_time` + `end_time` (seconds) on each word + a `transcript`
   * string. From these we can compute:
   *
   *   - `paceWpm` — words-per-minute over the scored window (utterance
   *     start = first word's start_time; utterance end = last word's
   *     end_time). Undefined when fewer than 2 words exist OR duration
   *     is non-positive.
   *   - `hesitationRate` — proportion of transcript tokens matching
   *     `ENGLISH_FILLER_TOKENS`. Bounded to [0, 1]. Undefined when
   *     transcript is empty.
   *
   * `meanEnergyDb` + `pitchRangeHz` are NOT supplied — SpeechAce's v9
   * payload doesn't expose acoustic energy or pitch range. The runner's
   * partial-fill merge cites them in the `fieldsMissing` AppLog.
   *
   * One vendor request — same endpoint as `scoreUploadedAudio` but with
   * `include_ielts_feedback` omitted.
   */
  async getGeneralSignals(
    buffer: Buffer,
    mimeType: string,
  ): Promise<Partial<GeneralSignals>> {
    if (!this.apiKey) {
      throw new Error(
        "SpeechAceAdapter: apiKey is not configured. Set credentials.apiKey on the SpeechAssessmentProvider row.",
      );
    }
    const url = new URL(SPEECHACE_ENDPOINT);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("dialect", this.dialect);
    if (this.userId) url.searchParams.set("user_id", this.userId);

    const form = new FormData();
    form.set(
      "user_audio_file",
      new Blob([new Uint8Array(buffer)], { type: mimeType }),
      filenameForMimeType(mimeType),
    );
    if (this.pronunciationScoreMode) {
      form.set("pronunciation_score_mode", this.pronunciationScoreMode);
    }

    const res = await fetch(url.toString(), { method: "POST", body: form });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `SpeechAceAdapter.getGeneralSignals: HTTP ${res.status}. Body: ${text.slice(0, 300)}`,
      );
    }
    const body = (await res.json()) as SpeechAceResponse;
    if (body.status && body.status !== "success") {
      throw new Error(
        `SpeechAceAdapter.getGeneralSignals: vendor returned status="${body.status}".`,
      );
    }
    return deriveSignalsFromSpeechAceResponse(body);
  }
}

/** Filename hint for the multipart upload. SpeechAce inspects the
 *  filename extension to pick a decoder — `audio.bin` is rejected. */
function filenameForMimeType(mimeType: string): string {
  if (mimeType.includes("wav")) return "audio.wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "audio.mp3";
  if (mimeType.includes("ogg")) return "audio.ogg";
  if (mimeType.includes("webm")) return "audio.webm";
  if (mimeType.includes("aiff")) return "audio.aiff";
  if (mimeType.includes("m4a") || mimeType.includes("aac"))
    return "audio.m4a";
  return "audio.wav";
}

interface SpeechAceWord {
  word?: string;
  start_time?: number;
  end_time?: number;
  start?: number;
  end?: number;
  startTime?: number;
  endTime?: number;
}

/**
 * Pure derivation — exported for direct unit-testing of the parser without
 * a live vendor call. The runner consumes via `adapter.getGeneralSignals`.
 */
export function deriveSignalsFromSpeechAceResponse(
  body: SpeechAceResponse,
): Partial<GeneralSignals> {
  const out: Partial<GeneralSignals> = {};

  const words = Array.isArray(body.speech_score?.word_score_list)
    ? (body.speech_score?.word_score_list as SpeechAceWord[])
    : [];
  const firstWordStart = firstNumericField(words[0], [
    "start_time", "start", "startTime",
  ]);
  const lastWordEnd = firstNumericField(words[words.length - 1], [
    "end_time", "end", "endTime",
  ]);
  if (
    words.length >= 2 &&
    typeof firstWordStart === "number" &&
    typeof lastWordEnd === "number" &&
    lastWordEnd > firstWordStart
  ) {
    const durationSec = lastWordEnd - firstWordStart;
    const durationMin = durationSec / 60;
    out.paceWpm = words.length / durationMin;
  }

  const transcript = body.speech_score?.transcript;
  if (typeof transcript === "string" && transcript.trim().length > 0) {
    out.hesitationRate = computeHesitationRate(transcript);
  }
  return out;
}

function firstNumericField(
  obj: SpeechAceWord | undefined,
  fields: readonly string[],
): number | undefined {
  if (!obj) return undefined;
  for (const f of fields) {
    const v = (obj as Record<string, unknown>)[f];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Filler-token ratio over the transcript. Tokenises on whitespace + strips
 * trailing punctuation. Bounded to [0, 1].
 */
export function computeHesitationRate(transcript: string): number {
  const tokens = transcript
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[.,!?;:"]+$/g, "").replace(/^["']+/g, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return 0;
  const fillers = tokens.filter((t) => ENGLISH_FILLER_TOKENS.has(t)).length;
  return Math.min(1, fillers / tokens.length);
}
