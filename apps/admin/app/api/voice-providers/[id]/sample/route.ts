import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * @operator-surface yes
 *
 * #1421 Slice B — voice sample button server route.
 *
 * Hard limits to protect cost + abuse:
 *   - 200-char hard cap on text (server-side; UI also caps)
 *   - rate-limit key "voice-sample" (defers to lib/rate-limit defaults)
 *   - OPERATOR+ auth (admin surfaces only)
 *
 * Dispatch:
 *   - voiceProvider === "deepgram" AND credentials.deepgramApiKey present
 *       → call Deepgram Aura TTS directly (preview matches live VAPI voice)
 *   - else → fall back to OpenAI TTS (preview voice ≠ live voice)
 *
 * No UsageEvent write in v1 — sample volume is tiny by construction
 * (rate-limited admin clicks). Promote to metered when volume warrants.
 */

const bodySchema = z
  .object({
    /** Text to synthesise. Hard-capped at 200 chars server-side. */
    text: z.string().min(1).max(200),
    /** TTS engine the voiceId belongs to. Mirrors `VoiceProvider.config.voiceProvider`. */
    voiceProvider: z.string().min(1).max(64),
    /** Voice ID per the catalog returned by `/api/voice/[slug]/catalog`. */
    voiceId: z.string().min(1).max(128),
  })
  .strict();

interface SampleDispatchResult {
  audioBytes: ArrayBuffer;
  /** Which engine actually generated the bytes ("deepgram" | "openai"). */
  engine: "deepgram" | "openai";
  /** True when the engine matches the educator's requested voiceProvider
   *  (the preview voice equals the live voice). False when we fell back. */
  isExactPreview: boolean;
}

/**
 * @api POST /api/voice-providers/[id]/sample
 * @visibility internal
 * @scope voice:sample:create
 * @auth session OPERATOR
 * @tags voice, voice-config, anyvoice
 * @description Generate a short TTS audio clip for the voice sample
 *   button. See file docblock for dispatch + guard details.
 *
 * @body { text: string (≤200), voiceProvider: string, voiceId: string }
 * @response 200 audio/mpeg binary stream (Content-Type:audio/mpeg)
 *   plus headers `X-HF-Sample-Engine` ("deepgram" | "openai") and
 *   `X-HF-Sample-Exact` ("true" | "false") so the UI can label the
 *   playback caveat without re-deriving from response shape.
 * @response 400 { ok: false, error: zod issues }
 * @response 401 { ok: false, error: "Unauthorized" }
 * @response 404 { ok: false, error: "VoiceProvider not found" }
 * @response 429 { ok: false, error: "Too many attempts…" }
 * @response 500 { ok: false, error: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const rl = checkRateLimit(getClientIP(request), "voice-sample");
  if (!rl.ok) return rl.error;

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.message },
      { status: 400 },
    );
  }

  const vp = await prisma.voiceProvider.findUnique({
    where: { id },
    select: { id: true, slug: true, credentials: true },
  });
  if (!vp) {
    return NextResponse.json(
      { ok: false, error: "VoiceProvider not found" },
      { status: 404 },
    );
  }

  const creds = (vp.credentials ?? {}) as Record<string, unknown>;
  const deepgramKey =
    typeof creds.deepgramApiKey === "string" && creds.deepgramApiKey.length > 0
      ? creds.deepgramApiKey
      : null;

  let result: SampleDispatchResult;
  try {
    result = await dispatchSample({
      text: parsed.data.text,
      voiceProvider: parsed.data.voiceProvider,
      voiceId: parsed.data.voiceId,
      deepgramKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[voice-sample]", message);
    return NextResponse.json(
      { ok: false, error: message || "Sample failed" },
      { status: 500 },
    );
  }

  return new Response(result.audioBytes, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      "X-HF-Sample-Engine": result.engine,
      "X-HF-Sample-Exact": String(result.isExactPreview),
    },
  });
}

/**
 * Dispatch the TTS call. Exported for unit-testing — the route shell
 * (auth, rate limit, DB read) doesn't need a vitest of its own; the
 * dispatch decision tree does.
 */
export async function dispatchSample(args: {
  text: string;
  voiceProvider: string;
  voiceId: string;
  /** HF's direct Deepgram API key when set on the VoiceProvider row.
   *  Drives the exact-preview branch. */
  deepgramKey: string | null;
}): Promise<SampleDispatchResult> {
  // Branch 1 — Deepgram direct (exact-preview path)
  if (args.voiceProvider === "deepgram" && args.deepgramKey) {
    const dg = await synthesizeViaDeepgram({
      text: args.text,
      voiceId: args.voiceId,
      apiKey: args.deepgramKey,
    });
    return { audioBytes: dg, engine: "deepgram", isExactPreview: true };
  }

  // Branch 2 — OpenAI fallback (always-available; preview voice ≠ live voice)
  const oai = await synthesizeViaOpenAI({
    text: args.text,
    voiceId: args.voiceProvider === "openai" ? args.voiceId : "nova",
  });
  return {
    audioBytes: oai,
    engine: "openai",
    isExactPreview: args.voiceProvider === "openai",
  };
}

async function synthesizeViaDeepgram(args: {
  text: string;
  voiceId: string;
  apiKey: string;
}): Promise<ArrayBuffer> {
  // Deepgram Aura TTS — `POST /v1/speak?model=aura-<voice>-en`
  // Returns audio/mpeg bytes directly. ~$0.015/min of audio.
  const model = `aura-${args.voiceId}-en`;
  const res = await fetch(
    `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=mp3`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: args.text }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Deepgram TTS returned HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  return res.arrayBuffer();
}

async function synthesizeViaOpenAI(args: {
  text: string;
  voiceId: string;
}): Promise<ArrayBuffer> {
  const apiKey = process.env.OPENAI_HF_MVP_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Neither HF Deepgram key nor OpenAI API key configured — no preview engine available.",
    );
  }
  const openai = new OpenAI({ apiKey });
  const audio = await openai.audio.speech.create({
    input: args.text,
    model: config.voice.ttsModel,
    voice: args.voiceId as OpenAI.Audio.Speech.SpeechCreateParams["voice"],
    response_format: "mp3",
  });
  return audio.arrayBuffer();
}
