import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * @api POST /api/vapi/knowledge
 * @visibility public
 * @scope vapi:knowledge
 * @auth webhook-secret
 * @tags vapi, knowledge, rag, deprecated
 * @description **Deprecated path — 307 redirect (AnyVoice #1079).**
 *   The canonical route is `/api/voice/vapi/knowledge`. HMAC verification
 *   runs exactly once on the canonical route. Update the VAPI dashboard
 *   Custom Knowledge Base URL to the new path; this shim stays live
 *   until that cutover is confirmed in every environment.
 */
export function POST(request: NextRequest): NextResponse {
  const target = new URL("/api/voice/vapi/knowledge", request.url);
  return NextResponse.redirect(target, 307);
}
