/**
 * Tests for `lib/voice/providers/retell/auth.ts::verifyRetellRequest` (audit HF-C).
 *
 * Closes the #1079 follow-up stub that returned null unconditionally (every Retell
 * webhook trusted unverified). Pins the HMAC contract:
 *   - valid x-retell-signature → null (proceed)
 *   - tampered body / wrong signature → 401
 *   - missing signature when a secret is configured → 401
 *   - no secret configured → pass-through null (local-dev ergonomics)
 */

import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyRetellRequest } from "@/lib/voice/providers/retell/auth";

const SECRET = "retell-test-secret";
const BODY = JSON.stringify({ event: "call_ended", call: { call_id: "abc" } });

function sign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function reqWith(sig: string | null): any {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "x-retell-signature" ? sig : null,
    },
  };
}

describe("verifyRetellRequest", () => {
  it("returns null (proceed) for a valid signature", () => {
    const res = verifyRetellRequest(reqWith(sign(BODY, SECRET)), BODY, SECRET);
    expect(res).toBeNull();
  });

  it("rejects a tampered body (signature no longer matches)", () => {
    const res = verifyRetellRequest(reqWith(sign(BODY, SECRET)), BODY + "x", SECRET);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const res = verifyRetellRequest(reqWith(sign(BODY, "wrong")), BODY, SECRET);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("rejects a missing signature when a secret is configured", () => {
    const res = verifyRetellRequest(reqWith(null), BODY, SECRET);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("passes through (null) when no secret is configured", () => {
    expect(verifyRetellRequest(reqWith(null), BODY, undefined)).toBeNull();
    expect(verifyRetellRequest(reqWith(null), BODY, "")).toBeNull();
  });
});
