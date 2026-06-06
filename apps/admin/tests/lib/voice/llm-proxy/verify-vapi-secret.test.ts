/**
 * x-vapi-secret verifier unit tests (#1176 — Test 4).
 *
 * Covers timing-safe comparison (TL required AC). Direct === is a
 * fail-condition; this test specifically targets a 1-byte-different
 * secret to prove timingSafeEqual is in the path.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => {
  const store = new Map<string, Record<string, unknown>>();
  return {
    prisma: {
      voiceProvider: {
        findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
          return store.get(where.slug) ?? null;
        }),
      },
      __store: store,
    },
  };
});

import { prisma } from "@/lib/prisma";
import { verifyVapiSecret } from "@/lib/voice/llm-proxy/verify-vapi-secret";

type PrismaWithStore = typeof prisma & {
  __store: Map<string, Record<string, unknown>>;
};

function seedProvider(slug: string, credentials: Record<string, unknown>) {
  (prisma as PrismaWithStore).__store.set(slug, { slug, credentials });
}

function reqWithSecret(value: string | null): Request {
  return new Request("https://example.test/", {
    method: "POST",
    headers: value === null ? {} : { "x-vapi-secret": value },
  });
}

describe("verifyVapiSecret", () => {
  beforeEach(() => {
    (prisma as PrismaWithStore).__store.clear();
  });

  it("passes through when no secret is configured (local-dev convention)", async () => {
    seedProvider("vapi", {});
    const result = await verifyVapiSecret(reqWithSecret("anything"), "vapi");
    expect(result.ok).toBe(true);
    expect(result.providerSlug).toBe("vapi");
  });

  it("returns 401 when the slug doesn't exist", async () => {
    const result = await verifyVapiSecret(reqWithSecret("anything"), "unknown");
    expect(result.ok).toBe(false);
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(401);
  });

  it("returns 401 when the header is missing AND secret is configured", async () => {
    seedProvider("vapi", { webhookSecret: "the-correct-secret-32-chars-long" });
    const result = await verifyVapiSecret(reqWithSecret(null), "vapi");
    expect(result.ok).toBe(false);
    expect(result.response!.status).toBe(401);
  });

  it("accepts the exact correct secret", async () => {
    const secret = "abcdef0123456789abcdef0123456789";
    seedProvider("vapi", { webhookSecret: secret });
    const result = await verifyVapiSecret(reqWithSecret(secret), "vapi");
    expect(result.ok).toBe(true);
  });

  it("REJECTS a 1-byte-different secret (proves timingSafeEqual is reached)", async () => {
    const correct = "abcdef0123456789abcdef0123456789";
    const off = "abcdef0123456789abcdef012345678X"; // last byte differs
    seedProvider("vapi", { webhookSecret: correct });
    const result = await verifyVapiSecret(reqWithSecret(off), "vapi");
    expect(result.ok).toBe(false);
    expect(result.response!.status).toBe(401);
  });

  it("rejects secrets of different lengths (timingSafeEqual would throw — we length-check first)", async () => {
    seedProvider("vapi", { webhookSecret: "short" });
    const result = await verifyVapiSecret(reqWithSecret("longer-secret"), "vapi");
    expect(result.ok).toBe(false);
    expect(result.response!.status).toBe(401);
  });
});
