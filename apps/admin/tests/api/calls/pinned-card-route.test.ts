/**
 * Tests for `GET /api/calls/[callId]/pinned-card` (#1744 Theme 3).
 *
 * Pinned acceptance:
 *   1. unknown callId → 404
 *   2. flag-off → 200 { card: null } regardless of metadata content
 *   3. flag-on + Session.metadata.pinnedCard present → returns the card
 *   4. flag-on + no metadata → 200 { card: null }
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    call: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    session: { user: { id: "u1", role: "OPERATOR" } },
  })),
  isAuthError: () => false,
}));
vi.mock("@/lib/learner-scope", () => ({
  studentAllowedToReadCaller: () => true,
  callerScopeMismatchResponse: () => new Response(null, { status: 403 }),
}));

import { GET } from "@/app/api/calls/[callId]/pinned-card/route";

function req() {
  return new Request("http://localhost/api/calls/call-1/pinned-card");
}
function params(callId: string) {
  return { params: Promise.resolve({ callId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
});

describe("GET /api/calls/[callId]/pinned-card", () => {
  it("(1) unknown callId → 404", async () => {
    mockPrisma.call.findUnique.mockResolvedValue(null);
    const res = await GET(req(), params("missing"));
    expect(res.status).toBe(404);
  });

  it("(2) flag-off → 200 { card: null } even when metadata present", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({
      callerId: "c1",
      session: {
        metadata: { pinnedCard: { kind: "cueCard", topic: "T", bullets: ["b"] } },
      },
    });
    const res = await GET(req(), params("call-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, card: null });
  });

  it("(3) flag-on + pinnedCard present → returns the card", async () => {
    process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
    const card = {
      kind: "cueCard",
      topic: "Describe a journey",
      bullets: ["where", "when"],
    };
    mockPrisma.call.findUnique.mockResolvedValue({
      callerId: "c1",
      session: { metadata: { pinnedCard: card } },
    });
    const res = await GET(req(), params("call-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, card });
  });

  it("(4) flag-on + no metadata → 200 { card: null }", async () => {
    process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
    mockPrisma.call.findUnique.mockResolvedValue({
      callerId: "c1",
      session: { metadata: null },
    });
    const res = await GET(req(), params("call-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, card: null });
  });
});
