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
