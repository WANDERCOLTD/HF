import { NextRequest } from "next/server";
import { handleVoiceToolsPost } from "@/lib/voice/route-handlers";

export const runtime = "nodejs";

/**
 * @api POST /api/voice/[slug]/tools
 * @visibility public
 * @scope voice:tools
 * @auth webhook-secret
 * @tags voice, tools, calls
 * @description Shared voice provider tool-call endpoint (AnyVoice #1079).
 *   Returns 404 when the resolved adapter declares
 *   `toolCallsOverWebSocket: true` — those providers send tools over
 *   their WSS handler, not this HTTP path.
 *
 *   HMAC verification runs exactly once on this canonical route. The
 *   legacy /api/vapi/tools path 307-redirects here.
 * @response 200 { results: [{ toolCallId, result }] }
 * @response 401 (HMAC failure)
 * @response 404 (WS-tools provider)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return handleVoiceToolsPost(request, slug);
}
