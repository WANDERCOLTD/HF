/**
 * Retell Webhook Authentication (audit HF-C — closes the #1079 follow-up stub).
 *
 * Retell signs every inbound webhook with an `x-retell-signature` header:
 * an HMAC-SHA256 of the raw request body, keyed by the account's secret.
 * Retell's own SDK keys the HMAC with the API key; HF stores a dedicated
 * `webhookSecret` when an org configures one, falling back to the API key
 * (Retell's default) otherwise.
 *
 * Mirrors `lib/voice/providers/vapi/auth.ts::verifyVapiRequest`:
 *   - Pass-through when no secret is configured (local-dev ergonomics; a
 *     provider with neither webhookSecret nor apiKey can't verify anything).
 *   - Missing `x-retell-signature` when a secret IS configured → 401.
 *   - Timing-safe hex comparison of the computed vs supplied signature.
 *
 * Returning a non-null NextResponse SHORT-CIRCUITS the webhook route with that
 * 401; returning null means "verified, proceed". The pre-HF-C stub returned
 * null unconditionally — i.e. every Retell webhook was trusted unverified.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

export function verifyRetellRequest(
  request: NextRequest,
  rawBody: string,
  secret: string | undefined,
): NextResponse | null {
  // Pass-through when unconfigured — matches the VAPI verifier's dev ergonomics.
  if (!secret) return null;

  const signature = request.headers.get("x-retell-signature");
  if (!signature) {
    console.warn("[retell/auth] Missing x-retell-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // Length-guard before timingSafeEqual (it throws on unequal-length buffers).
  if (signature.length !== expected.length) {
    console.warn("[retell/auth] Invalid webhook signature (length mismatch)");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const valid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );

  if (!valid) {
    console.warn("[retell/auth] Invalid webhook signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  return null;
}
