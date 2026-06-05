/**
 * Tests for POST /api/identity/resend-pin (#1101).
 *
 * Covers:
 *   - Success path (within cap, no cooldown) → ok: true
 *   - Resend cap reached → { resendCapReached: true }
 *     ★ critical: count query MUST filter resendCount > 0 so initial
 *       enrolment issuance doesn't eat a slot (TL review fix)
 *   - Cooldown active → { cooldownSecondsRemaining: number }
 *   - No active caller / no email on file → { noActiveCaller: true }
 *   - STUDENT-scope: foreign callerId is locked to own caller
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  caller: { findUnique: vi.fn() },
  callerIdentityChallenge: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

const mockRequireAuth = vi.fn();
const mockIsAuthError = vi.fn();
vi.mock("@/lib/permissions", () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
  isAuthError: (...a: unknown[]) => mockIsAuthError(...a),
}));

const mockResolveScope = vi.fn();
const mockIsScopeError = vi.fn();
vi.mock("@/lib/learner-scope", () => ({
  resolveCallerScopeForReading: (...a: unknown[]) => mockResolveScope(...a),
  isScopeError: (...a: unknown[]) => mockIsScopeError(...a),
}));

const mockIssueFirstCallPin = vi.fn();
vi.mock("@/lib/identity/issue-pin", () => ({
  issueFirstCallPin: (...a: unknown[]) => mockIssueFirstCallPin(...a),
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/identity/resend-pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/identity/resend-pin", () => {
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "u-1", email: "l@example.com", role: "STUDENT" } },
    });
    mockIsAuthError.mockReturnValue(false);
    mockResolveScope.mockResolvedValue({ scopedCallerId: "caller-own" });
    mockIsScopeError.mockReturnValue(false);
    mockPrisma.caller.findUnique.mockResolvedValue({
      email: "learner@example.com",
      name: "Test Learner",
    });
    mockIssueFirstCallPin.mockResolvedValue({ challengeId: "ch-new" });
    const mod = await import("@/app/api/identity/resend-pin/route");
    POST = mod.POST;
  });

  it("issues a resend when under cap and outside cooldown", async () => {
    mockPrisma.callerIdentityChallenge.count.mockResolvedValue(1);
    mockPrisma.callerIdentityChallenge.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ callerId: "caller-own" }));
    const body = await res.json();

    expect(body).toEqual({ ok: true });
    expect(mockIssueFirstCallPin).toHaveBeenCalledWith({
      callerId: "caller-own",
      email: "learner@example.com",
      firstName: "Test",
      isResend: true,
    });
  });

  it("cap query filters resendCount > 0 (excludes initial issuance)", async () => {
    mockPrisma.callerIdentityChallenge.count.mockResolvedValue(0);
    mockPrisma.callerIdentityChallenge.findFirst.mockResolvedValue(null);

    await POST(makeRequest({ callerId: "caller-own" }));

    const countCall = mockPrisma.callerIdentityChallenge.count.mock.calls[0][0];
    expect(countCall.where.resendCount).toEqual({ gt: 0 });
    expect(countCall.where.callerId).toBe("caller-own");
    expect(countCall.where.issuedAt.gte).toBeInstanceOf(Date);
  });

  it("returns resendCapReached when 3 resends already used in 24h", async () => {
    mockPrisma.callerIdentityChallenge.count.mockResolvedValue(3);

    const res = await POST(makeRequest({ callerId: "caller-own" }));
    const body = await res.json();

    expect(body).toEqual({ ok: false, resendCapReached: true });
    expect(mockIssueFirstCallPin).not.toHaveBeenCalled();
  });

  it("returns cooldownSecondsRemaining when a recent resend is within the cooldown window", async () => {
    mockPrisma.callerIdentityChallenge.count.mockResolvedValue(1);
    mockPrisma.callerIdentityChallenge.findFirst.mockResolvedValue({
      issuedAt: new Date(Date.now() - 20_000), // 20s ago
    });

    const res = await POST(makeRequest({ callerId: "caller-own" }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.cooldownSecondsRemaining).toBeGreaterThan(0);
    expect(body.cooldownSecondsRemaining).toBeLessThanOrEqual(60);
    expect(mockIssueFirstCallPin).not.toHaveBeenCalled();
  });

  it("returns noActiveCaller when caller has no email on file", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ email: null, name: "X" });

    const res = await POST(makeRequest({ callerId: "caller-own" }));
    const body = await res.json();

    expect(body).toEqual({ ok: false, noActiveCaller: true });
    expect(mockIssueFirstCallPin).not.toHaveBeenCalled();
  });

  it("STUDENT-scope: foreign callerId in body is replaced by own caller before any DB read", async () => {
    mockResolveScope.mockResolvedValue({ scopedCallerId: "caller-own" });
    mockPrisma.callerIdentityChallenge.count.mockResolvedValue(0);
    mockPrisma.callerIdentityChallenge.findFirst.mockResolvedValue(null);

    await POST(makeRequest({ callerId: "caller-VICTIM" }));

    expect(mockPrisma.caller.findUnique).toHaveBeenCalledWith({
      where: { id: "caller-own" },
      select: expect.any(Object),
    });
    if (mockIssueFirstCallPin.mock.calls.length > 0) {
      expect(mockIssueFirstCallPin.mock.calls[0][0].callerId).toBe("caller-own");
    }
  });

  it("returns 400 when body is malformed", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});
