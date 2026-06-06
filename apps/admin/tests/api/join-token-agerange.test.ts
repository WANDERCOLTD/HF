/**
 * Tests for #1036 — ageRange propagation through /api/join/[token].
 *
 * Lives in its own file because `tests/api/join-token.test.ts` is in
 * the vitest quarantine list (ratchet `quarantined_tests` baseline 37).
 * Keeping the #1036 surface unquarantined ensures regressions to the
 * propagation gap surface immediately in CI.
 *
 * Covered behaviours:
 *   1. Valid ageRange → CallerAttribute.upsert with intake.ageRange key
 *   2. ageRange === "under-18" → 400 BEFORE any DB lookup (defence-in-depth)
 *   3. Omitted ageRange → no CallerAttribute write (back-compat preserved)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

/** Build a Request with a NextRequest-shaped `cookies.get()` stub. */
function makeRequest(body: Record<string, unknown>): Request {
  const req = new Request("http://localhost/api/join/validtok", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  Object.defineProperty(req, "cookies", {
    value: { get: () => undefined },
  });
  // NextRequest.nextUrl.origin is read in app/api/join/[token]/route.ts
  // when stamping the enrollment originUrl. A plain Request has no
  // nextUrl, so the route NPEs without this stub.
  Object.defineProperty(req, "nextUrl", {
    value: { origin: "http://localhost" },
  });
  return req;
}

const mockPrisma = {
  cohortGroup: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  caller: {
    findFirst: vi.fn(),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
  },
  callerCohortMembership: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  callerAttribute: {
    upsert: vi.fn(),
  },
  // POST /api/join/[token] calls issueFirstCallPin (#1101) which inserts
  // a CallerIdentityChallenge row via prisma.callerIdentityChallenge.create.
  // Returning a synthetic id is enough — the route reads `.id` to compose
  // the email magic-link URL.
  callerIdentityChallenge: {
    create: vi.fn().mockResolvedValue({ id: "challenge-mock-id" }),
  },
  // Pin-email send goes through MessagingProvider.send (#1101). The provider
  // resolution chain reads from messagingProvider.findFirst — empty result
  // makes the route fall through to the no-op log path.
  messagingProvider: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
  $transaction: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("next-auth/jwt", () => ({
  encode: vi.fn().mockResolvedValue("mock-jwt-token"),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  getClientIP: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/enrollment", () => ({
  enrollCaller: vi.fn().mockResolvedValue(undefined),
  enrollCallerInCohortPlaybooks: vi.fn().mockResolvedValue(undefined),
}));

// =====================================================
// TESTS
// =====================================================

describe("/api/join/[token] — ageRange propagation (#1036)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.NEXTAUTH_SECRET = "test-secret";
  });

  it("writes intake.ageRange CallerAttribute when ageRange is provided (new-user path)", async () => {
    mockPrisma.cohortGroup.findUnique.mockResolvedValue({
      id: "cohort-1",
      name: "Year 10",
      isActive: true,
      joinToken: "validtok",
      domainId: "domain-1",
      domain: { id: "domain-1" },
    });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: "new-user-1", email: "tessa@example.com" });
    mockPrisma.caller.create.mockResolvedValue({ id: "new-caller-1" });
    mockPrisma.callerAttribute.upsert.mockResolvedValue({});
    mockPrisma.callerCohortMembership.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
    );

    const { POST } = await import("../../app/api/join/[token]/route");
    const request = makeRequest({
      firstName: "Tessa",
      lastName: "Bloom",
      email: "tessa@example.com",
      ageRange: "25-34",
    });
    await POST(request as never, { params: Promise.resolve({ token: "validtok" }) });

    expect(mockPrisma.callerAttribute.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          callerId_key_scope: {
            callerId: "new-caller-1",
            key: "intake.ageRange",
            scope: "GLOBAL",
          },
        },
        create: expect.objectContaining({
          callerId: "new-caller-1",
          key: "intake.ageRange",
          scope: "GLOBAL",
          valueType: "STRING",
          stringValue: "25-34",
          sourceSpecSlug: "EnrollmentIntake",
        }),
        update: { stringValue: "25-34" },
      }),
    );
  });

  it("returns 400 for ageRange=under-18 (defence-in-depth vs URL tampering)", async () => {
    const { POST } = await import("../../app/api/join/[token]/route");
    const request = makeRequest({
      firstName: "Tessa",
      lastName: "Bloom",
      email: "tessa@example.com",
      ageRange: "under-18",
    });
    const response = await POST(request as never, {
      params: Promise.resolve({ token: "validtok" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Under-18");
    // Proves the gate fires BEFORE any DB lookup.
    expect(mockPrisma.cohortGroup.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.callerAttribute.upsert).not.toHaveBeenCalled();
  });

  it("skips CallerAttribute write when ageRange is omitted", async () => {
    mockPrisma.cohortGroup.findUnique.mockResolvedValue({
      id: "cohort-1",
      name: "Year 10",
      isActive: true,
      joinToken: "validtok",
      domainId: "domain-1",
      domain: { id: "domain-1" },
    });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: "new-user-1", email: "alice@school.com" });
    mockPrisma.caller.create.mockResolvedValue({ id: "new-caller-1" });
    mockPrisma.callerCohortMembership.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
    );

    const { POST } = await import("../../app/api/join/[token]/route");
    const request = makeRequest({
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@school.com",
    });
    await POST(request as never, { params: Promise.resolve({ token: "validtok" }) });

    expect(mockPrisma.callerAttribute.upsert).not.toHaveBeenCalled();
  });
});
