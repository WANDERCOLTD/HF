import { NextRequest } from "next/server";
import { handleVoiceKnowledgePost } from "@/lib/voice/route-handlers";

export const runtime = "nodejs";

/**
 * @api POST /api/voice/[slug]/knowledge
 * @visibility public
 * @scope voice:knowledge
 * @auth webhook-secret
 * @tags voice, knowledge, rag
 * @description Shared voice provider per-turn knowledge callback
 *   (AnyVoice #1079). Returns 404 when the resolved adapter declares
 *   `hasKnowledgeCallback: false` — those providers consume pre-
 *   uploaded knowledge IDs (e.g. Retell `knowledge_base_ids`) and
 *   never POST here.
 *
 *   HMAC verification runs exactly once on this canonical route. The
 *   legacy /api/vapi/knowledge path 307-redirects here.
 * @response 200 (provider-shaped knowledge response)
 * @response 401 (HMAC failure)
 * @response 404 (no-knowledge-callback provider)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return handleVoiceKnowledgePost(request, slug);
}
