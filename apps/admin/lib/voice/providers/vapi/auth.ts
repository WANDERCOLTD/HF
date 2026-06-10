/**
 * VAPI Webhook Authentication (AnyVoice #1031, extended #TBD-webhook-secret).
 *
 * VAPI has TWO independent webhook auth schemes; this verifier accepts
 * EITHER:
 *
 *   1. `x-vapi-secret: <plain-value>` — sent when the assistant config
 *      includes `serverUrlSecret`. Plain shared-secret comparison;
 *      no HMAC. **This is what HF's dynamic inline assistants use** —
 *      `lib/voice/providers/vapi/index.ts::buildAssistantConfig` sets
 *      `assistant.serverUrlSecret = credentials.webhookSecret` so VAPI
 *      knows to add this header to every webhook for this call.
 *
 *   2. `x-vapi-signature: <HMAC-SHA256(rawBody, secret)>` — sent when
 *      the operator configures HMAC at the org level via the VAPI
 *      dashboard. Cryptographically stronger, harder to set up.
 *
 * Both compare against the SAME stored value
 * (`VoiceProvider.credentials.webhookSecret`). The verifier returns
 * null on the FIRST matching path; defence in depth.
 *
 * Live evidence on hf-dev 2026-06-10: 20+ webhook 401s logged as
 * "Missing x-vapi-signature header" — VAPI never sent that header
 * because (a) it wasn't configured at the org level, and (b) HF
 * wasn't telling VAPI to use `serverUrlSecret` either. Fix: set
 * `assistant.serverUrlSecret` in the per-call payload AND accept
 * `x-vapi-secret` plain header here.
 *
 * Pass-through when `secret` is empty/undefined preserves local-dev
 * ergonomics.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

export function verifyVapiRequest(
  request: NextRequest,
  rawBody: string,
  secret: string | undefined,
): NextResponse | null {
  if (!secret) return null;

  // Path 1 — plain `x-vapi-secret` header (HF's dynamic-assistant path).
  // When VAPI sends this header, it WILL NOT also send x-vapi-signature
  // (the two schemes are mutually exclusive in VAPI's outbound webhook
  // implementation). So a present-but-mismatched x-vapi-secret means
  // "fail" — don't fall through to the HMAC path.
  const plainHeader = request.headers.get("x-vapi-secret");
  if (plainHeader !== null) {
    const secretBuf = Buffer.from(secret);
    const plainBuf = Buffer.from(plainHeader);
    if (
      plainBuf.length === secretBuf.length &&
      crypto.timingSafeEqual(secretBuf, plainBuf)
    ) {
      return null;
    }
    console.warn("[vapi/auth] Invalid x-vapi-secret header (value mismatch)");
    return NextResponse.json({ error: "Invalid x-vapi-secret" }, { status: 401 });
  }

  // Path 2 — HMAC `x-vapi-signature` (VAPI dashboard-configured HMAC).
  const signature = request.headers.get("x-vapi-signature");
  if (!signature) {
    console.warn(
      "[vapi/auth] Missing both x-vapi-secret and x-vapi-signature headers",
    );
    return NextResponse.json(
      { error: "Missing signature or secret" },
      { status: 401 },
    );
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  if (signature.length !== expected.length) {
    console.warn("[vapi/auth] Invalid webhook signature (length mismatch)");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const valid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );

  if (!valid) {
    console.warn("[vapi/auth] Invalid webhook signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  return null;
}
