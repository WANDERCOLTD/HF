import { NextRequest } from "next/server";
import { handleVoiceAssistantRequestPost } from "@/lib/voice/route-handlers";

export const runtime = "nodejs";

/**
 * @api POST /api/voice/[slug]/assistant-request
 * @visibility public
 * @scope voice:assistant
 * @auth webhook-secret
 * @tags voice, composition, calls
 * @description Shared voice provider call-start endpoint (AnyVoice #1079).
 *   Dispatches by slug to the adapter resolved from the VoiceProvider
 *   DB row. Identifies caller by phone, loads the active ComposedPrompt,
 *   builds the adapter's assistant config.
 *
 *   HMAC verification runs exactly once on this canonical route. The
 *   legacy /api/vapi/assistant-request path 307-redirects here.
 * @response 200 (provider-shaped assistant config)
 * @response 400 { error: "No customer phone number provided" }
 * @response 401 (HMAC failure)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return handleVoiceAssistantRequestPost(request, slug);
}
