/**
 * VAPI Webhook Authentication
 *
 * Verifies VAPI webhook signatures using HMAC-SHA256.
 * All VAPI endpoints should call verifyVapiRequest() before processing.
 */

import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import crypto from "node:crypto";

/**
 * Verify a VAPI webhook request signature.
 * Returns null if valid, or a 401 NextResponse if invalid.
 *
 * When VAPI_WEBHOOK_SECRET is not configured, requests pass through
 * (allows local dev without VAPI integration).
 */
export function verifyVapiRequest(
  request: NextRequest,
  rawBody: string,
): NextResponse | null {
  const secret = config.vapi.webhookSecret;
  if (!secret) return null; // No secret configured → allow (local dev)

  const signature = request.headers.get("x-vapi-signature");
  if (!signature) {
    console.warn("[vapi/auth] Missing x-vapi-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // Use timing-safe comparison, but handle length mismatch
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

  return null; // Valid
}
