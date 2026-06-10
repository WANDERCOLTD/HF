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

function makeRequest(opts: {
  signature?: string;
  plainSecret?: string;
} = {}): NextRequest {
  const req = new NextRequest("https://example.com/api/vapi/webhook", {
    method: "POST",
    body: JSON.stringify({ event: "call.completed" }),
  });
  vi.spyOn(req.headers, "get").mockImplementation((name) => {
    if (name === "x-vapi-signature") return opts.signature ?? null;
    if (name === "x-vapi-secret") return opts.plainSecret ?? null;
    return null;
  });
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

  it("returns 401 when both x-vapi-secret and x-vapi-signature are missing", async () => {
    const req = makeRequest();
    const result = verifyVapiRequest(req, '{"event":"call.completed"}', SECRET);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    const body = await result!.json();
    expect(body.error).toBe("Missing signature or secret");
  });

  it("returns 401 when signature length does not match expected HMAC", async () => {
    const req = makeRequest({ signature: "tooshort" });
    const result = verifyVapiRequest(req, '{"event":"call.completed"}', SECRET);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    const body = await result!.json();
    expect(body.error).toBe("Invalid signature");
  });

  it("returns 401 when signature is correct length but wrong value", async () => {
    const body = '{"event":"call.completed"}';
    const wrongSig = "a".repeat(64);
    const req = makeRequest({ signature: wrongSig });
    const result = verifyVapiRequest(req, body, SECRET);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    const resBody = await result!.json();
    expect(resBody.error).toBe("Invalid signature");
  });

  it("returns null (pass) when HMAC-SHA256 signature is valid", () => {
    const body = '{"event":"call.completed","callId":"abc123"}';
    const sig = makeSignature(SECRET, body);
    const req = makeRequest({ signature: sig });
    const result = verifyVapiRequest(req, body, SECRET);
    expect(result).toBeNull();
  });

  it("returns 401 when body is tampered after signing", async () => {
    const originalBody = '{"event":"call.completed"}';
    const tamperedBody = '{"event":"call.ended"}';
    const sig = makeSignature(SECRET, originalBody);
    const req = makeRequest({ signature: sig });
    const result = verifyVapiRequest(req, tamperedBody, SECRET);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  // #TBD-webhook-secret — x-vapi-secret plain shared-secret path
  describe("x-vapi-secret plain-header path (#TBD-webhook-secret)", () => {
    it("returns null (pass) when x-vapi-secret matches the stored secret", () => {
      const req = makeRequest({ plainSecret: SECRET });
      const result = verifyVapiRequest(req, '{"event":"any"}', SECRET);
      expect(result).toBeNull();
    });

    it("returns 401 when x-vapi-secret is present but wrong value", async () => {
      const req = makeRequest({ plainSecret: "wrong-secret-key" });
      const result = verifyVapiRequest(req, '{"event":"any"}', SECRET);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
      const body = await result!.json();
      expect(body.error).toBe("Invalid x-vapi-secret");
    });

    it("returns 401 when x-vapi-secret is present but length mismatches stored", async () => {
      const req = makeRequest({ plainSecret: "x" });
      const result = verifyVapiRequest(req, '{"event":"any"}', SECRET);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });

    it("does NOT fall through to HMAC path when x-vapi-secret is wrong", () => {
      // Same request also has a valid HMAC signature — but x-vapi-secret
      // takes precedence and rejects. This matches VAPI's mutually-
      // exclusive behaviour: it sends ONE auth header per webhook,
      // never both.
      const body = '{"event":"any"}';
      const validSig = makeSignature(SECRET, body);
      const req = makeRequest({
        plainSecret: "wrong-secret-key",
        signature: validSig,
      });
      const result = verifyVapiRequest(req, body, SECRET);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });

    it("falls through to HMAC path when x-vapi-secret is absent (header=null)", () => {
      const body = '{"event":"any","callId":"x"}';
      const sig = makeSignature(SECRET, body);
      // No plainSecret → falls through to HMAC verification on signature.
      const req = makeRequest({ signature: sig });
      const result = verifyVapiRequest(req, body, SECRET);
      expect(result).toBeNull();
    });
  });
});
