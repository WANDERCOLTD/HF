/**
 * Tests for Call Interject API:
 *   POST /api/calls/[callId]/interject — Teacher sends message into active call
 *
 * Business rules:
 *   - Only accessible to authenticated educators
 *   - Educator must own the student's cohort
 *   - Call must exist, have a callerId, and not be ended
 *   - Creates message with role "teacher" and senderName
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  call: {
    findUnique: vi.fn(),
  },
  caller: {
    findUnique: vi.fn(),
  },
  callMessage: {
    create: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/educator-access", () => ({
  requireEducator: vi.fn().mockResolvedValue({
    session: {
      user: { id: "edu-user-1", email: "teacher@test.com", role: "EDUCATOR" },
    },
    callerId: "edu-caller-1",
  }),
  isEducatorAuthError: vi.fn(
    (result: Record<string, unknown>) => "error" in result
  ),
  requireEducatorStudentAccess: vi.fn().mockResolvedValue({
    student: {
      id: "student-1",
      name: "Alice",
      cohortGroup: { id: "c1", name: "Year 10", ownerId: "edu-caller-1" },
    },
  }),
}));

// =====================================================
// HELPERS
// =====================================================

function makeParams<T extends Record<string, string>>(obj: T) {
  return { params: Promise.resolve(obj) };
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// =====================================================
// TESTS
// =====================================================

describe("POST /api/calls/[callId]/interject", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/calls/[callId]/interject/route");
    POST = mod.POST;
  });

  it("creates teacher message successfully", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({
      id: "call-1",
      callerId: "student-1",
      endedAt: null,
    });
    mockPrisma.caller.findUnique.mockResolvedValue({ name: "Mrs. Smith" });
    mockPrisma.callMessage.create.mockResolvedValue({
      id: "msg-1",
      role: "teacher",
      content: "Good job!",
      senderName: "Mrs. Smith",
      createdAt: new Date(),
    });

    const res = await POST(
      makeRequest({ content: "Good job!" }),
      makeParams({ callId: "call-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message.role).toBe("teacher");
    expect(body.message.senderName).toBe("Mrs. Smith");
    expect(body.message.content).toBe("Good job!");
  });

  it("rejects empty content", async () => {
    const res = await POST(
      makeRequest({ content: "" }),
      makeParams({ callId: "call-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/content.*required/i);
  });

  it("rejects missing content", async () => {
    const res = await POST(
      makeRequest({}),
      makeParams({ callId: "call-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
  });

  it("returns 404 for nonexistent call", async () => {
    mockPrisma.call.findUnique.mockResolvedValue(null);

    const res = await POST(
      makeRequest({ content: "Hello" }),
      makeParams({ callId: "nonexistent" })
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  it("rejects call with no callerId", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({
      id: "call-1",
      callerId: null,
      endedAt: null,
    });

    const res = await POST(
      makeRequest({ content: "Hello" }),
      makeParams({ callId: "call-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/no associated student/i);
  });

  it("rejects ended call", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({
      id: "call-1",
      callerId: "student-1",
      endedAt: new Date(),
    });

    const res = await POST(
      makeRequest({ content: "Hello" }),
      makeParams({ callId: "call-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/already ended/i);
  });

  it("rejects when educator does not own student's cohort", async () => {
    mockPrisma.call.findUnique.mockResolvedValue({
      id: "call-1",
      callerId: "student-other",
      endedAt: null,
    });

    const { requireEducatorStudentAccess } = await import(
      "@/lib/educator-access"
    );
    const mockAccess = vi.mocked(requireEducatorStudentAccess);
    mockAccess.mockResolvedValueOnce({
      error: NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      ),
    });

    const res = await POST(
      makeRequest({ content: "Hello" }),
      makeParams({ callId: "call-1" })
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/forbidden/i);
  });
});
