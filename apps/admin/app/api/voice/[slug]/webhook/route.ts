import { NextRequest } from "next/server";
import { handleVoiceWebhookPost } from "@/lib/voice/route-handlers";

export const runtime = "nodejs";

/**
 * @api POST /api/voice/[slug]/webhook
 * @visibility public
 * @scope voice:webhook
 * @auth webhook-secret
 * @tags voice, calls, ingest
 * @description Shared voice provider webhook endpoint (AnyVoice #1079).
 *   Dispatches by slug to the adapter resolved from the VoiceProvider
 *   DB row. Handles single-event (VAPI: end-of-call-report) and split-
 *   event (Retell: call_ended + call_analyzed) end-of-call shapes.
 *
 *   For split-event providers, the basic event creates the Call row and
 *   the analysis event merges-and-triggers the pipeline. Pipeline never
 *   fires on a bare basic event.
 *
 *   HMAC verification runs exactly once on this canonical route. The
 *   legacy /api/vapi/webhook path 307-redirects here.
 * @response 200 { ok: true, callId, callerId? }
 * @response 400 { error: "Invalid JSON body" }
 * @response 401 (HMAC failure)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return handleVoiceWebhookPost(request, slug);
}
