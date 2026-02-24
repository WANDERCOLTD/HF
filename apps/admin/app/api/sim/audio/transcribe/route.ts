import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { config } from "@/lib/config";
import { getVoiceIOSettings } from "@/lib/system-settings";

/**
 * @api POST /api/sim/audio/transcribe
 * @visibility internal
 * @auth session
 * @minRole VIEWER
 * @tags sim, audio, voice
 * @description Transcribe an audio blob using OpenAI Whisper. Used by the voice sim.
 * @body FormData: { audio: Blob }
 * @response 200 { ok: true, transcript: string }
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

    const formData = await request.formData();
    const audioBlob = formData.get("audio") as File | null;
    if (!audioBlob) {
      return NextResponse.json({ ok: false, error: "audio field required" }, { status: 400 });
    }

    const settings = await getVoiceIOSettings();
    const openai = new OpenAI({ apiKey });

    const transcription = await openai.audio.transcriptions.create({
      file: audioBlob,
      model: config.voice.whisperModel,
      language: settings.whisperLanguage,
    });

    return NextResponse.json({ ok: true, transcript: transcription.text });
  } catch (error: any) {
    console.error("[sim/audio/transcribe]", error?.message || error);
    return NextResponse.json({ ok: false, error: "Transcription failed" }, { status: 500 });
  }
}
