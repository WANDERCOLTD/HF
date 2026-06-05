/**
 * SpeechSuper English Spontaneous Speech adapter (#1118).
 *
 * Wraps SpeechSuper's `speak.eval.pro` core (English unscripted IELTS
 * scoring). Auth uses two SHA-1 signatures, both computed per call from
 * a per-call epoch timestamp:
 *   - connectSig = sha1(appKey + timestamp + secretKey)            (hex)
 *   - startSig   = sha1(appKey + timestamp + userId + secretKey)   (hex)
 *
 * Both signatures + a JSON params blob are posted multipart alongside
 * the audio file. The endpoint URL is path-suffixed with the coreType:
 *   POST https://api.speechsuper.com/speak.eval.pro
 *
 * Docs source: https://docs.speechsuper.com. Reference implementation:
 * https://github.com/speechsuper/SpeechSuper-API-Samples
 * (http_samples/python_http_sample/sample.py).
 *
 * Audio constraints: 16-bit, 16kHz, mono. WAV format expected; adapter
 * passes the buffer through verbatim — caller is responsible for any
 * resampling. Test-connection MUST NOT call this endpoint (per-second
 * cost).
 */

import * as crypto from "node:crypto";

import type { ProviderConfigSchema } from "@/lib/voice/types";
import type {
  NormalisedScoreResult,
  ScoringMode,
  SpeechAssessmentAdapter,
  SpeechAssessmentCapabilities,
} from "@/lib/speech-assessment/types";

const SPEECHSUPER_BASE_URL = "https://api.speechsuper.com/";
const CORE_TYPE_SPONTANEOUS_IELTS = "speak.eval.pro";

interface SpeechSuperCredentials {
  appKey?: string;
  secretKey?: string;
}

interface SpeechSuperConfig {
  defaultUserId?: string;
  /** `non_native` (default — IELTS candidates) or `native`. */
  model?: string;
  penalizeOfftopic?: boolean;
}

interface SpeechSuperIeltsBlock {
  overall?: number;
  pronunciation?: number;
  fluency?: number;
  grammar?: number;
  vocabulary?: number;
  coherence?: number;
}

interface SpeechSuperResponse {
  errId?: number;
  error?: string;
  result?: {
    ielts?: SpeechSuperIeltsBlock;
    overall?: number;
    pronunciation?: number;
    fluency?: number;
    grammar?: number;
    vocabulary?: number;
    transcription?: string;
    words?: unknown;
  };
}

export class SpeechSuperAdapter implements SpeechAssessmentAdapter {
  readonly slug = "speechsuper";
  private readonly appKey: string | undefined;
  private readonly secretKey: string | undefined;
  private readonly defaultUserId: string;
  private readonly model: string;
  private readonly penalizeOfftopic: boolean;

  constructor(
    credentials: Record<string, unknown>,
    config: Record<string, unknown>,
  ) {
    const creds = credentials as SpeechSuperCredentials;
    const cfg = config as SpeechSuperConfig;
    this.appKey = creds.appKey;
    this.secretKey = creds.secretKey;
    this.defaultUserId = cfg.defaultUserId ?? "guest";
    this.model = cfg.model ?? "non_native";
    this.penalizeOfftopic = cfg.penalizeOfftopic ?? false;
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
      prosodyFeatures: true,
    };
  }

  getConfigSchema(): ProviderConfigSchema {
    return {
      fields: [
        {
          key: "appKey",
          label: "SpeechSuper app key",
          type: "string",
          help: "Application key issued by SpeechSuper (the public half of the credential pair). Combined with the secret key to form per-request HMAC-SHA1 signatures.",
          sensitive: true,
          required: true,
        },
        {
          key: "secretKey",
          label: "SpeechSuper secret key",
          type: "string",
          help: "Secret key paired with the app key. Used to sign every request — never sent to the vendor directly. Rotate via the SpeechSuper dashboard if leaked.",
          sensitive: true,
          required: true,
        },
        {
          key: "defaultUserId",
          label: "Default user ID (billing attribution)",
          type: "string",
          default: "guest",
          help: "Anonymised identifier passed as the SpeechSuper `userId` field. Used by their dashboard to break down cost per end-user. Adapter falls back to `guest` when blank.",
        },
        {
          key: "model",
          label: "Scoring model",
          type: "enum",
          enumValues: ["non_native", "native"],
          default: "non_native",
          help: "`non_native` is the IELTS candidate default (more lenient on accent). `native` enforces native-speaker norms — use for advanced learners only.",
        },
        {
          key: "penalizeOfftopic",
          label: "Penalise off-topic answers",
          type: "boolean",
          default: false,
          help: "When `true`, SpeechSuper deducts marks if the response strays from the prompt. Leave off unless you're feeding the prompt in via the question_prompt field — without context this just produces false negatives.",
        },
      ],
    };
  }

  async scoreUploadedAudio(
    buffer: Buffer,
    mimeType: string,
    mode: ScoringMode,
  ): Promise<NormalisedScoreResult> {
    if (!this.appKey || !this.secretKey) {
      throw new Error(
        "SpeechSuperAdapter: appKey and secretKey are not both configured. Set credentials.{appKey,secretKey} on the SpeechAssessmentProvider row.",
      );
    }

    const coreType = CORE_TYPE_SPONTANEOUS_IELTS;
    const url = `${SPEECHSUPER_BASE_URL}${coreType}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const userId = this.defaultUserId;

    const connectSig = crypto
      .createHash("sha1")
      .update(`${this.appKey}${timestamp}${this.secretKey}`)
      .digest("hex");
    const startSig = crypto
      .createHash("sha1")
      .update(`${this.appKey}${timestamp}${userId}${this.secretKey}`)
      .digest("hex");

    const audioType = audioTypeForMimeType(mimeType);

    const params = {
      connect: {
        cmd: "connect",
        param: {
          sdk: { version: 16777472, source: 9, protocol: 2 },
          app: { applicationId: this.appKey, sig: connectSig, timestamp },
        },
      },
      start: {
        cmd: "start",
        param: {
          app: {
            userId,
            applicationId: this.appKey,
            timestamp,
            sig: startSig,
          },
          audio: {
            audioType,
            channel: 1,
            sampleBytes: 2,
            sampleRate: 16000,
          },
          request: {
            coreType,
            tokenId: "tokenId",
            ...(mode === "ielts" ? { test_type: "ielts" } : {}),
            model: this.model,
            penalize_offtopic: this.penalizeOfftopic ? 1 : 0,
          },
        },
      },
    };

    const form = new FormData();
    form.set("text", JSON.stringify(params));
    form.set(
      "audio",
      new Blob([new Uint8Array(buffer)], { type: mimeType }),
      `audio.${audioType}`,
    );

    const res = await fetch(url, {
      method: "POST",
      headers: { "Request-Index": "0" },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `SpeechSuperAdapter: HTTP ${res.status} from ${coreType}. Body: ${text.slice(0, 300)}`,
      );
    }

    const body = (await res.json()) as SpeechSuperResponse;

    if (body.errId !== undefined && body.errId !== 0) {
      throw new Error(
        `SpeechSuperAdapter: vendor returned errId=${body.errId} (${body.error ?? "unknown"})`,
      );
    }

    const result = body.result;
    const ieltsBlock = result?.ielts;
    const overall = ieltsBlock?.overall ?? result?.overall;
    const pronunciation =
      ieltsBlock?.pronunciation ?? result?.pronunciation;
    const fluency = ieltsBlock?.fluency ?? result?.fluency;
    const grammar = ieltsBlock?.grammar ?? result?.grammar;
    const vocabulary = ieltsBlock?.vocabulary ?? result?.vocabulary;
    const coherence = ieltsBlock?.coherence;

    return {
      ielts:
        overall !== undefined
          ? {
              overall,
              pronunciation: pronunciation ?? 0,
              fluency: fluency ?? 0,
              ...(grammar !== undefined ? { grammar } : {}),
              ...(vocabulary !== undefined ? { vocabulary } : {}),
              ...(coherence !== undefined ? { coherence } : {}),
            }
          : undefined,
      transcript: result?.transcription,
      diagnostics: result?.words,
      raw: body,
    };
  }
}

function audioTypeForMimeType(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mp3") || mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("webm")) return "webm";
  return "wav";
}
