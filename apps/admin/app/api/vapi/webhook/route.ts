import { NextRequest, NextResponse } from "next/server";
import { extractVapiCapture as extractCanonicalCapture } from "@/lib/voice/providers/vapi";

export const runtime = "nodejs";

/**
 * @api POST /api/vapi/webhook
 * @visibility public
 * @scope vapi:webhook
 * @auth webhook-secret
 * @tags vapi, calls, ingest, deprecated
 * @description **Deprecated path — 307 redirect (AnyVoice #1079).**
 *   The canonical route is `/api/voice/vapi/webhook`. HMAC verification
 *   runs exactly once on the canonical route. Operators should update
 *   the VAPI dashboard server URL to point at the new path; this shim
 *   stays live until that cutover is confirmed in every environment.
 *   307 preserves POST method and body — VAPI's HTTP client follows.
 */
export function POST(request: NextRequest): NextResponse {
  const target = new URL("/api/voice/vapi/webhook", request.url);
  return NextResponse.redirect(target, 307);
}

/**
 * Re-export for backward compatibility — the existing test at
 * `tests/lib/vapi-extract-capture.test.ts` imports this name. The
 * canonical extractor lives at `lib/voice/providers/vapi::extractVapiCapture`
 * and returns provider-neutral key names; this shim translates those to
 * the post-#1020 Call-column names (`voice*`-prefixed). The shim now
 * exists purely to keep the test surface stable — once the test imports
 * directly from the canonical extractor + asserts canonical keys, this
 * re-export goes away.
 */
export function extractVapiCapture(message: unknown): Record<string, unknown> {
  const c = extractCanonicalCapture(message);
  const out: Record<string, unknown> = {};
  if (c.recordingUrl !== undefined) out.recordingUrl = c.recordingUrl;
  if (c.stereoRecordingUrl !== undefined) out.stereoRecordingUrl = c.stereoRecordingUrl;
  if (c.durationSeconds !== undefined) out.voiceDurationSeconds = c.durationSeconds;
  if (c.endedReason !== undefined) out.voiceEndedReason = c.endedReason;
  if (c.costUsd !== undefined) out.voiceCostUsd = c.costUsd;
  if (c.analysisSummary !== undefined) out.voiceAnalysisSummary = c.analysisSummary;
  if (c.structuredData !== undefined) out.voiceStructuredData = c.structuredData;
  if (c.successEvaluation !== undefined) out.voiceSuccessEvaluation = c.successEvaluation;
  return out;
}
