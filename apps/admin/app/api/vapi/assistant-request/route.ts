import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * @api POST /api/vapi/assistant-request
 * @visibility public
 * @scope vapi:assistant
 * @auth webhook-secret
 * @tags vapi, composition, calls, deprecated
 * @description **Deprecated path — 307 redirect (AnyVoice #1079).**
 *   The canonical route is `/api/voice/vapi/assistant-request`. HMAC
 *   verification runs exactly once on the canonical route. Update
 *   the VAPI dashboard server URL to the new path; this shim stays
 *   live until that cutover is confirmed in every environment.
 */
export function POST(request: NextRequest): NextResponse {
  const target = new URL("/api/voice/vapi/assistant-request", request.url);
  return NextResponse.redirect(target, 307);
}
