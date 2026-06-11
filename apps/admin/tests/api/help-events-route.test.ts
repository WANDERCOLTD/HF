/**
 * Tests for /api/help/events — #1484 (Epic #1442 Layer 3 Slice 3).
 *
 * Pins the fire-and-forget contract:
 *   (a) zod-validated body — missing `type` returns 422
 *   (b) DB error swallowed — route still returns 202
 *   plus auth (OPERATOR+) and the happy-path 202.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  helpEvent: { create: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const mockRequireAuth = vi.fn();
const mockIsAuthError = vi.fn();
vi.mock("@/lib/permissions", () => ({
  requireAuth: mockRequireAuth,
  isAuthError: mockIsAuthError,
}));

const mockCheckRateLimit = vi.fn();
const mockGetClientIP = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIP: mockGetClientIP,
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/help/events", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("/api/help/events", () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockIsAuthError.mockReturnValue(false);
    mockRequireAuth.mockResolvedValue({
      session: {
        user: {
          id: "u-1",
          email: "a@b.com",
          name: "Operator",
          role: "OPERATOR",
        },
        expires: new Date(Date.now() + 86400000).toISOString(),
      },
    });

    mockGetClientIP.mockReturnValue("127.0.0.1");
    mockCheckRateLimit.mockReturnValue({ ok: true });
    mockPrisma.helpEvent.create.mockResolvedValue({ id: "he-1" });

    const mod = await import("../../app/api/help/events/route");
    POST = mod.POST as unknown as (req: NextRequest) => Promise<Response>;
  });

  it("returns 202 on a well-formed event", async () => {
    const res = await POST(
      makeRequest({ type: "doc-section-view", target: "demos" }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 422 when `type` is missing (zod rejection)", async () => {
    const res = await POST(makeRequest({ target: "demos" }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid body");
    // Critical: the DB must NOT have been called for an invalid body
    expect(mockPrisma.helpEvent.create).not.toHaveBeenCalled();
  });

  it("still returns 202 even when prisma.helpEvent.create throws (fire-and-forget)", async () => {
    // Simulate the DB write blowing up — the route MUST swallow it.
    mockPrisma.helpEvent.create.mockRejectedValue(
      new Error("ECONNREFUSED: DB unreachable"),
    );

    const res = await POST(
      makeRequest({ type: "cascade-inspector-open", target: "BEH-WARMTH" }),
    );

    // 202 regardless of DB state — telemetry must NEVER block UI.
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("rejects non-OPERATOR sessions with the requireAuth error response", async () => {
    const forbiddenResponse = Response.json(
      { error: "Forbidden" },
      { status: 403 },
    );
    mockIsAuthError.mockReturnValue(true);
    mockRequireAuth.mockResolvedValue({ error: forbiddenResponse });

    const res = await POST(
      makeRequest({ type: "doc-section-view", target: "demos" }),
    );
    expect(res.status).toBe(403);
    expect(mockPrisma.helpEvent.create).not.toHaveBeenCalled();
  });

  it("rejects requests over rate-limit with the limiter's 429 response", async () => {
    const limited = Response.json({ error: "rate" }, { status: 429 });
    mockCheckRateLimit.mockReturnValue({ ok: false, error: limited, retryAfter: 60 });

    const res = await POST(
      makeRequest({ type: "doc-section-view", target: "demos" }),
    );
    expect(res.status).toBe(429);
    expect(mockPrisma.helpEvent.create).not.toHaveBeenCalled();
  });
});
