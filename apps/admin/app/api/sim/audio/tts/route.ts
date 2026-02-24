import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { config } from "@/lib/config";
import { getVoiceIOSettings } from "@/lib/system-settings";

/**
 * @api POST /api/sim/audio/tts
 * @visibility internal
 * @auth session
 * @minRole VIEWER
 * @tags sim, audio, voice
 * @description Convert text to speech using OpenAI TTS. Returns audio/mpeg stream. Used by the voice sim.
 * @body { text: string }
 * @response 200 audio/mpeg binary stream
 * @response 400 { ok: false, error: string }
 * @response 500 { ok: false, error: string }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const apiKey = process.env.OPENAI_HF_MVP_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "OpenAI API key not configured" }, { status: 500 });
    }

    const body = await request.json();
    const text = (body?.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ ok: false, error: "text field required" }, { status: 400 });
    }

    const settings = await getVoiceIOSettings();
    const openai = new OpenAI({ apiKey });

    const audio = await openai.audio.speech.create({
      input: text,
      model: config.voice.ttsModel,
      voice: settings.ttsVoice as OpenAI.Audio.Speech.SpeechCreateParams["voice"],
      speed: settings.ttsSpeakingRate,
      response_format: "mp3",
    });

    const arrayBuffer = await audio.arrayBuffer();

    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("[sim/audio/tts]", error?.message || error);
    return NextResponse.json({ ok: false, error: "TTS failed" }, { status: 500 });
  }
}
