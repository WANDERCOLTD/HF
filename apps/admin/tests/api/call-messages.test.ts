/**
 * Tests for Call Messages API:
 *   POST /api/calls/[callId]/messages — Store a message during an active call
 *   GET  /api/calls/[callId]/messages — Fetch messages (optionally filtered)
 *
 * Business rules:
 *   - POST validates role and (content or mediaId)
 *   - POST only accepts "user", "assistant", or "teacher" role
 *   - GET supports ?after= and ?role= filters
 *   - GET returns callEnded flag
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  call: {
    findUnique: vi.fn(),
  },
  callMessage: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: {
      user: { id: "user-1", email: "user@test.com", role: "TESTER" },
    },
  }),
  isAuthError: vi.fn(
    (result: Record<string, unknown>) => "error" in result
  ),
}));

// =====================================================
// HELPERS
// =====================================================

function makeParams<T extends Record<string, string>>(obj: T) {
  return { params: Promise.resolve(obj) };
}

function makePostRequest(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(query = "") {
  return new NextRequest(
    new URL(`http://localhost:3000/api/calls/call-1/messages${query}`),
    { method: "GET" }
  );
}

// =====================================================
// POST /api/calls/[callId]/messages
// =====================================================

describe("POST /api/calls/[callId]/messages", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/calls/[callId]/messages/route");
    POST = mod.POST;
  });

  it("creates a message successfully", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({ id: "call-1" });
    mockPrisma.callMessage.create.mockResolvedValue({
      id: "msg-1",
      role: "user",
      content: "Hello",
      createdAt: new Date(),
    });

    const res = await POST(
      makePostRequest({ role: "user", content: "Hello" }),
      makeParams({ callId: "call-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message.content).toBe("Hello");
  });

  it("rejects missing role", async () => {
    const res = await POST(
      makePostRequest({ content: "Hello" }),
      makeParams({ callId: "call-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/role and \(content or mediaId\)/i);
  });

  it("rejects missing content and mediaId", async () => {
    const res = await POST(
      makePostRequest({ role: "user" }),
      makeParams({ callId: "call-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/role and \(content or mediaId\)/i);
  });

  it("accepts teacher role via POST", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({ id: "call-1" });
    mockPrisma.callMessage.create.mockResolvedValue({
      id: "msg-2",
      role: "teacher",
      content: "Teacher message",
      createdAt: new Date(),
    });

    const res = await POST(
      makePostRequest({ role: "teacher", content: "Teacher message" }),
      makeParams({ callId: "call-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message.role).toBe("teacher");
  });

  it("rejects invalid role", async () => {
    const res = await POST(
      makePostRequest({ role: "system", content: "Not allowed" }),
      makeParams({ callId: "call-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/user.*assistant.*teacher/i);
  });

  it("returns 404 for nonexistent call", async () => {
    mockPrisma.call.findUnique.mockResolvedValue(null);

    const res = await POST(
      makePostRequest({ role: "user", content: "Hello" }),
      makeParams({ callId: "nonexistent" })
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });
});

// =====================================================
// GET /api/calls/[callId]/messages
// =====================================================

describe("GET /api/calls/[callId]/messages", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/calls/[callId]/messages/route");
    GET = mod.GET;
  });

  it("returns all messages for a call", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({ endedAt: null });
    mockPrisma.callMessage.findMany.mockResolvedValue([
      { id: "msg-1", role: "user", content: "Hi", senderName: null, createdAt: new Date() },
      { id: "msg-2", role: "assistant", content: "Hello!", senderName: null, createdAt: new Date() },
    ]);

    const res = await GET(
      makeGetRequest(),
      makeParams({ callId: "call-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.messages).toHaveLength(2);
    expect(body.callEnded).toBe(false);
  });

  it("returns callEnded=true when call has ended", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({ endedAt: new Date() });
    mockPrisma.callMessage.findMany.mockResolvedValue([]);

    const res = await GET(
      makeGetRequest(),
      makeParams({ callId: "call-1" })
    );
    const body = await res.json();

    expect(body.callEnded).toBe(true);
  });

  it("filters by after parameter", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({ endedAt: null });
    mockPrisma.callMessage.findMany.mockResolvedValue([]);

    const afterTs = new Date("2026-02-14T10:00:00Z").toISOString();
    await GET(
      makeGetRequest(`?after=${afterTs}`),
      makeParams({ callId: "call-1" })
    );

    expect(mockPrisma.callMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          callId: "call-1",
          createdAt: { gt: expect.any(Date) },
        }),
      })
    );
  });

  it("filters by role parameter", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({ endedAt: null });
    mockPrisma.callMessage.findMany.mockResolvedValue([]);

    await GET(
      makeGetRequest("?role=teacher"),
      makeParams({ callId: "call-1" })
    );

    expect(mockPrisma.callMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          callId: "call-1",
          role: "teacher",
        }),
      })
    );
  });
});
