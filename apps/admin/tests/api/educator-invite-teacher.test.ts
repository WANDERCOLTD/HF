/**
 * Tests for Educator Invite Teacher API:
 *   POST /api/educator/invite-teacher — Invite another educator/teacher
 *
 * Business rules:
 *   - Only accessible to authenticated educators
 *   - Creates invite with role EDUCATOR, callerRole TEACHER
 *   - Rejects invalid/missing email
 *   - Rejects if user already exists
 *   - Rejects if pending invite exists
 *   - Allows re-invite if previous invite was used (deletes old)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
  },
  invite: {
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
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
}));

// Note: crypto.randomUUID is not mocked — we don't assert on the token value

// =====================================================
// TESTS
// =====================================================

describe("POST /api/educator/invite-teacher", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/educator/invite-teacher/route");
    POST = mod.POST;
  });

  function makeRequest(body: Record<string, unknown>) {
    return new NextRequest(new URL("http://localhost:3000"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("creates invite with correct role and callerRole", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.invite.findUnique.mockResolvedValue(null);
    mockPrisma.invite.create.mockResolvedValue({
      id: "inv-1",
      email: "newteacher@test.com",
      token: "test-uuid-1234",
      expiresAt: new Date("2026-04-01"),
    });

    const res = await POST(makeRequest({ email: "newteacher@test.com" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.invite.email).toBe("newteacher@test.com");
    expect(body.inviteUrl).toContain("/invite/accept?token=");

    // Verify the invite was created with the right data
    expect(mockPrisma.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "newteacher@test.com",
          role: "EDUCATOR",
          callerRole: "TEACHER",
          invitedById: "edu-user-1",
        }),
      })
    );
  });

  it("rejects missing email", async () => {
    const res = await POST(makeRequest({}));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/email/i);
  });

  it("rejects invalid email (no @)", async () => {
    const res = await POST(makeRequest({ email: "notanemail" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("rejects if user already exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "existing-user" });

    const res = await POST(makeRequest({ email: "existing@test.com" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/already exists/i);
  });

  it("rejects if pending invite exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.invite.findUnique.mockResolvedValue({
      id: "inv-old",
      usedAt: null, // pending
    });

    const res = await POST(makeRequest({ email: "pending@test.com" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/already pending/i);
  });

  it("deletes used invite and creates new one", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.invite.findUnique.mockResolvedValue({
      id: "inv-old",
      usedAt: new Date("2026-01-01"), // used
    });
    mockPrisma.invite.delete.mockResolvedValue({});
    mockPrisma.invite.create.mockResolvedValue({
      id: "inv-new",
      email: "reinvite@test.com",
      token: "test-uuid-1234",
      expiresAt: new Date("2026-04-01"),
    });

    const res = await POST(makeRequest({ email: "reinvite@test.com" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockPrisma.invite.delete).toHaveBeenCalledWith({
      where: { id: "inv-old" },
    });
  });

  it("normalises email to lowercase", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.invite.findUnique.mockResolvedValue(null);
    mockPrisma.invite.create.mockResolvedValue({
      id: "inv-1",
      email: "teacher@test.com",
      token: "test-uuid-1234",
      expiresAt: new Date("2026-04-01"),
    });

    await POST(makeRequest({ email: "  Teacher@Test.COM  " }));

    expect(mockPrisma.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "teacher@test.com",
        }),
      })
    );
  });
});
