/**
 * Tests for lib/voice/providers/vapi/auth.ts — VAPI Webhook Authentication
 * (moved from lib/vapi/auth.ts in #1017, refactored to take secret as
 * argument in #1031 so the function is pure and the DB-driven factory
 * can pass the credential through).
 *
 * Covers:
 * - No secret configured → pass through (local dev)
 * - Missing x-vapi-signature header → 401
 * - Signature length mismatch → 401
 * - Invalid signature → 401
 * - Valid HMAC-SHA256 signature → null (pass)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import { verifyVapiRequest } from "@/lib/voice/providers/vapi/auth";
import { NextRequest } from "next/server";

const SECRET = "test-secret-key";

function makeRequest(signature?: string): NextRequest {
  const req = new NextRequest("https://example.com/api/vapi/webhook", {
    method: "POST",
    body: JSON.stringify({ event: "call.completed" }),
  });
  if (signature !== undefined) {
    vi.spyOn(req.headers, "get").mockImplementation((name) => {
      if (name === "x-vapi-signature") return signature;
      return null;
    });
  } else {
    vi.spyOn(req.headers, "get").mockImplementation(() => null);
  }
  return req;
}

function makeSignature(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifyVapiRequest", () => {
  it("returns null (pass) when no webhook secret is configured", () => {
    const req = makeRequest();
    const result = verifyVapiRequest(req, '{"event":"call.completed"}', "");
    expect(result).toBeNull();
  });

  it("returns 401 when x-vapi-signature header is missing", async () => {
    const req = makeRequest(undefined);
    const result = verifyVapiRequest(req, '{"event":"call.completed"}', SECRET);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    const body = await result!.json();
    expect(body.error).toBe("Missing signature");
  });

  it("returns 401 when signature length does not match expected HMAC", async () => {
    const req = makeRequest("tooshort");
    const result = verifyVapiRequest(req, '{"event":"call.completed"}', SECRET);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    const body = await result!.json();
    expect(body.error).toBe("Invalid signature");
  });

  it("returns 401 when signature is correct length but wrong value", async () => {
    const body = '{"event":"call.completed"}';
    const wrongSig = "a".repeat(64);
    const req = makeRequest(wrongSig);
    const result = verifyVapiRequest(req, body, SECRET);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    const resBody = await result!.json();
    expect(resBody.error).toBe("Invalid signature");
  });

  it("returns null (pass) when HMAC-SHA256 signature is valid", () => {
    const body = '{"event":"call.completed","callId":"abc123"}';
    const sig = makeSignature(SECRET, body);
    const req = makeRequest(sig);
    const result = verifyVapiRequest(req, body, SECRET);
    expect(result).toBeNull();
  });

  it("returns 401 when body is tampered after signing", async () => {
    const originalBody = '{"event":"call.completed"}';
    const tamperedBody = '{"event":"call.ended"}';
    const sig = makeSignature(SECRET, originalBody);
    const req = makeRequest(sig);
    const result = verifyVapiRequest(req, tamperedBody, SECRET);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });
});
