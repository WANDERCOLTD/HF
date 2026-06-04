/**
 * Tests for lib/voice/providers/vapi/auth.ts — VAPI Webhook Authentication
 * (moved from lib/vapi/auth.ts in AnyVoice #1017).
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

// ── Mock config (vi.hoisted so the factory can reference it) ──
const mockConfig = vi.hoisted(() => ({ vapi: { webhookSecret: "test-secret-key" } }));

vi.mock("@/lib/config", () => ({
  config: mockConfig,
}));

// ── Import after mocks ───────────────────────────────
import { verifyVapiRequest } from "@/lib/voice/providers/vapi/auth";
import { NextRequest } from "next/server";

// ── Helpers ──────────────────────────────────────────

function makeRequest(signature?: string): NextRequest {
  const req = new NextRequest("https://example.com/api/vapi/webhook", {
    method: "POST",
    body: JSON.stringify({ event: "call.completed" }),
  });
  if (signature !== undefined) {
    // NextRequest headers are read-only — spy on .get()
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

// ── Tests ────────────────────────────────────────────

describe("verifyVapiRequest", () => {
  it("returns null (pass) when no webhook secret is configured", () => {
    mockConfig.vapi.webhookSecret = "";
    const req = makeRequest();
    const result = verifyVapiRequest(req, '{"event":"call.completed"}');
    expect(result).toBeNull();
  });

  it("returns 401 when x-vapi-signature header is missing", async () => {
    mockConfig.vapi.webhookSecret = "test-secret-key";
    const req = makeRequest(undefined); // no signature header
    const result = verifyVapiRequest(req, '{"event":"call.completed"}');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    const body = await result!.json();
    expect(body.error).toBe("Missing signature");
  });

  it("returns 401 when signature length does not match expected HMAC", async () => {
    mockConfig.vapi.webhookSecret = "test-secret-key";
    const req = makeRequest("tooshort");
    const result = verifyVapiRequest(req, '{"event":"call.completed"}');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    const body = await result!.json();
    expect(body.error).toBe("Invalid signature");
  });

  it("returns 401 when signature is correct length but wrong value", async () => {
    mockConfig.vapi.webhookSecret = "test-secret-key";
    const body = '{"event":"call.completed"}';
    // Generate a valid-length hex but with wrong content
    const wrongSig = "a".repeat(64);
    const req = makeRequest(wrongSig);
    const result = verifyVapiRequest(req, body);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    const resBody = await result!.json();
    expect(resBody.error).toBe("Invalid signature");
  });

  it("returns null (pass) when HMAC-SHA256 signature is valid", () => {
    const secret = "test-secret-key";
    mockConfig.vapi.webhookSecret = secret;
    const body = '{"event":"call.completed","callId":"abc123"}';
    const sig = makeSignature(secret, body);
    const req = makeRequest(sig);
    const result = verifyVapiRequest(req, body);
    expect(result).toBeNull();
  });

  it("returns 401 when body is tampered after signing", async () => {
    const secret = "test-secret-key";
    mockConfig.vapi.webhookSecret = secret;
    const originalBody = '{"event":"call.completed"}';
    const tamperedBody = '{"event":"call.ended"}';
    const sig = makeSignature(secret, originalBody);
    const req = makeRequest(sig);
    const result = verifyVapiRequest(req, tamperedBody);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });
});
