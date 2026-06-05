/**
 * Tests for POST /api/identity/verify-pin (#1101).
 *
 * Covers:
 *   - Success path (match + valid)
 *   - Match + expired → { expired: true } and attemptCount NOT incremented
 *   - Wrong PIN → attemptsRemaining decremented; ≥ maxAttempts → locked
 *   - Pre-existing lockout in 24h window short-circuits before hash check
 *   - No active challenge → { noActiveChallenge: true }
 *   - STUDENT-scope: body callerId is ignored; resolves to own caller
 *   - Body validation: 400 on missing/short PIN
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const mockPrisma = {
  callerIdentityChallenge: {
    findFirst: vi.fn(),
    update: vi.fn(),
    aggregate: vi.fn(),
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

const mockVerifyPinHash = vi.fn();
vi.mock("@/lib/identity/pin", () => ({
  verifyPinHash: (...a: unknown[]) => mockVerifyPinHash(...a),
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/identity/verify-pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function activeChallenge(overrides: Partial<{
  id: string;
  pinHash: string;
  expiresAt: Date;
  attemptCount: number;
}> = {}) {
  return {
    id: "challenge-1",
    pinHash: "bcrypt-hash",
    expiresAt: new Date(Date.now() + 3600_000),
    attemptCount: 0,
    ...overrides,
  };
}

describe("POST /api/identity/verify-pin", () => {
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "u-1", email: "l@example.com", role: "STUDENT" } },
    });
    mockIsAuthError.mockReturnValue(false);
    mockResolveScope.mockResolvedValue({ scopedCallerId: "caller-own" });
    mockIsScopeError.mockReturnValue(false);
    const mod = await import("@/app/api/identity/verify-pin/route");
    POST = mod.POST;
  });

  it("returns ok: true when the PIN matches and challenge is not expired", async () => {
    mockPrisma.callerIdentityChallenge.findFirst
      .mockResolvedValueOnce(null) // lockout probe
      .mockResolvedValueOnce(activeChallenge()); // active challenge fetch
    mockVerifyPinHash.mockResolvedValue(true);
    mockPrisma.callerIdentityChallenge.update.mockResolvedValue({});

    const res = await POST(makeRequest({ callerId: "caller-own", pin: "123456" }));
    const body = await res.json();

    expect(body).toEqual({ ok: true });
    expect(mockPrisma.callerIdentityChallenge.update).toHaveBeenCalledWith({
      where: { id: "challenge-1" },
      data: { verifiedAt: expect.any(Date) },
    });
  });

  it("returns { expired: true } without incrementing attemptCount when PIN matches an expired challenge", async () => {
    mockPrisma.callerIdentityChallenge.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        activeChallenge({ expiresAt: new Date(Date.now() - 1000) }),
      );
    mockVerifyPinHash.mockResolvedValue(true);

    const res = await POST(makeRequest({ callerId: "caller-own", pin: "123456" }));
    const body = await res.json();

    expect(body).toEqual({ ok: false, expired: true });
    expect(mockPrisma.callerIdentityChallenge.update).not.toHaveBeenCalled();
  });

  it("decrements attemptsRemaining on wrong PIN", async () => {
    mockPrisma.callerIdentityChallenge.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeChallenge({ attemptCount: 1 }));
    mockVerifyPinHash.mockResolvedValue(false);
    mockPrisma.callerIdentityChallenge.update.mockResolvedValue({});
    mockPrisma.callerIdentityChallenge.aggregate.mockResolvedValue({
      _sum: { attemptCount: 2 },
    });

    const res = await POST(makeRequest({ callerId: "caller-own", pin: "000000" }));
    const body = await res.json();

    expect(body).toEqual({ ok: false, attemptsRemaining: 3 });
    // first update is attemptCount++; lockedAt update only fires at threshold
    expect(mockPrisma.callerIdentityChallenge.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.callerIdentityChallenge.update).toHaveBeenCalledWith({
      where: { id: "challenge-1" },
      data: { attemptCount: { increment: 1 } },
    });
  });

  it("locks the caller when 24h aggregate attempts reaches maxAttempts", async () => {
    mockPrisma.callerIdentityChallenge.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeChallenge({ attemptCount: 4 }));
    mockVerifyPinHash.mockResolvedValue(false);
    mockPrisma.callerIdentityChallenge.update.mockResolvedValue({});
    mockPrisma.callerIdentityChallenge.aggregate.mockResolvedValue({
      _sum: { attemptCount: 5 },
    });

    const res = await POST(makeRequest({ callerId: "caller-own", pin: "000000" }));
    const body = await res.json();

    expect(body).toEqual({ ok: false, locked: true });
    // both updates: attemptCount++ and lockedAt=NOW
    expect(mockPrisma.callerIdentityChallenge.update).toHaveBeenCalledTimes(2);
    const setLockCall = mockPrisma.callerIdentityChallenge.update.mock.calls[1][0];
    expect(setLockCall.data.lockedAt).toBeInstanceOf(Date);
  });

  it("short-circuits to locked when a 24h-window challenge is already lockedAt", async () => {
    mockPrisma.callerIdentityChallenge.findFirst.mockResolvedValueOnce({
      id: "locked-row",
    });

    const res = await POST(makeRequest({ callerId: "caller-own", pin: "123456" }));
    const body = await res.json();

    expect(body).toEqual({ ok: false, locked: true });
    expect(mockVerifyPinHash).not.toHaveBeenCalled();
    expect(mockPrisma.callerIdentityChallenge.update).not.toHaveBeenCalled();
  });

  it("returns noActiveChallenge when caller has no unverified challenge", async () => {
    mockPrisma.callerIdentityChallenge.findFirst
      .mockResolvedValueOnce(null) // lockout probe
      .mockResolvedValueOnce(null); // active challenge fetch

    const res = await POST(makeRequest({ callerId: "caller-own", pin: "123456" }));
    const body = await res.json();

    expect(body).toEqual({ ok: false, noActiveChallenge: true });
  });

  it("STUDENT-scope: a foreign callerId in the body is replaced by the session's own caller", async () => {
    mockResolveScope.mockResolvedValue({ scopedCallerId: "caller-own" });
    mockPrisma.callerIdentityChallenge.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeChallenge());
    mockVerifyPinHash.mockResolvedValue(true);
    mockPrisma.callerIdentityChallenge.update.mockResolvedValue({});

    await POST(makeRequest({ callerId: "caller-VICTIM", pin: "123456" }));

    // every prisma query must use the resolved own-caller id, never the body one
    const findFirstCalls = mockPrisma.callerIdentityChallenge.findFirst.mock.calls;
    for (const call of findFirstCalls) {
      expect(call[0].where.callerId).toBe("caller-own");
    }
  });

  it("returns scope-error response when resolveCallerScopeForReading errors", async () => {
    const errorResponse = NextResponse.json(
      { ok: false, error: "No learner profile found" },
      { status: 403 },
    );
    mockResolveScope.mockResolvedValue({ error: errorResponse });
    mockIsScopeError.mockReturnValue(true);

    const res = await POST(makeRequest({ callerId: "caller-1", pin: "123456" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when body is missing or malformed", async () => {
    const res1 = await POST(makeRequest({ callerId: "caller-own" })); // no pin
    expect(res1.status).toBe(400);
    const res2 = await POST(makeRequest({ callerId: "caller-own", pin: "abc" }));
    expect(res2.status).toBe(400);
    const res3 = await POST(makeRequest({ callerId: "caller-own", pin: "12345" }));
    expect(res3.status).toBe(400);
  });
});
