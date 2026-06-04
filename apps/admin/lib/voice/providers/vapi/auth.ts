/**
 * VAPI Webhook Authentication (AnyVoice #1031).
 *
 * Verifies VAPI webhook signatures using HMAC-SHA256. The secret comes
 * from the `VoiceProvider.credentials.webhookSecret` field (DB) via the
 * factory + adapter constructor — NOT from env vars after #1031.
 *
 * Pure function: pass the secret in. The VapiProvider class is the only
 * caller and it resolves the secret at construction time from its
 * `credentials` constructor arg. A transient env-var fallback exists in
 * VapiProvider itself for the deploy-window before the seed has run.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

/**
 * Verify a VAPI webhook request signature.
 * Returns null if valid, or a 401 NextResponse if invalid.
 *
 * When the secret is unset (empty string or undefined), requests pass
 * through — preserves local-dev ergonomics. Production safety is the
 * caller's responsibility (the VapiProvider constructor will warn when
 * the secret is missing during the deploy-window cutover).
 */
export function verifyVapiRequest(
  request: NextRequest,
  rawBody: string,
  secret: string | undefined,
): NextResponse | null {
  if (!secret) return null;

  const signature = request.headers.get("x-vapi-signature");
  if (!signature) {
    console.warn("[vapi/auth] Missing x-vapi-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
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
