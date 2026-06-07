/**
 * Tests for PATCH /api/callers/[callerId]/phone — admin test-caller
 * takeover path.
 *
 * Behaviour summary (this PR adds the OPERATOR+ override):
 *   - Conflict with a REAL caller (externalId not "admin-test-*") →
 *     still 409 regardless of session role
 *   - Conflict with an ADMIN-TEST caller AND OPERATOR+ session →
 *     transaction clears the old phone, sets the new, returns 200
 *     with takeoverFrom
 *   - Conflict with an ADMIN-TEST caller AND STUDENT session →
 *     still 409 (no privilege escalation)
 *   - No conflict → unchanged 200 path
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("@/lib/permissions");

const mockCallerFindUnique = vi.fn();
const mockCallerFindFirst = vi.fn();
const mockCallerUpdate = vi.fn();
const mockTransaction = vi.fn();
const mockRequireAuth = vi.fn();
const mockResolveScope = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    caller: {
      findUnique: (...args: unknown[]) => mockCallerFindUnique(...args),
      findFirst: (...args: unknown[]) => mockCallerFindFirst(...args),
      update: (...args: unknown[]) => mockCallerUpdate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (v: unknown): v is { error: unknown } =>
    Boolean(v && typeof v === "object" && "error" in (v as Record<string, unknown>)),
}));

vi.mock("@/lib/learner-scope", () => ({
  resolveCallerScopeForReading: (...args: unknown[]) => mockResolveScope(...args),
  isScopeError: (v: unknown): v is { error: unknown } =>
    Boolean(v && typeof v === "object" && "error" in (v as Record<string, unknown>)),
}));

vi.mock("@/lib/voice/phone-format", () => ({
  toE164: (s: string) => (s.startsWith("+") ? s : `+${s.replace(/\D/g, "")}`),
  isE164: (s: string) => /^\+\d{7,15}$/.test(s),
}));

vi.mock("@/lib/roles", () => ({
  ROLE_LEVEL: {
    DEMO: 0,
    VIEWER: 1,
    TESTER: 1,
    STUDENT: 1,
    SUPER_TESTER: 2,
    OPERATOR: 3,
    EDUCATOR: 3,
    ADMIN: 4,
    SUPERADMIN: 5,
  },
}));

function makeAuth(role: string, userId = "admin-1") {
  return {
    session: {
      expires: new Date(Date.now() + 86400000).toISOString(),
      user: { id: userId, email: "u@example.com", name: "U", image: null, role },
    },
  };
}

async function callPatch(callerId: string, body: unknown) {
  const mod = await import("@/app/api/callers/[callerId]/phone/route");
  const req = new Request(`http://test/api/callers/${callerId}/phone`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await mod.PATCH(req, { params: Promise.resolve({ callerId }) });
  const json = await res.json();
  return { status: res.status, json };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/callers/[id]/phone — admin test-caller takeover", () => {
  it("OPERATOR+ takeover from an admin-test caller (externalId 'admin-test-*') succeeds", async () => {
    mockRequireAuth.mockResolvedValue(makeAuth("OPERATOR"));
    mockResolveScope.mockResolvedValue({ scopedCallerId: "new-caller" });
    mockCallerFindUnique.mockResolvedValue({ id: "new-caller", phone: null });
    mockCallerFindFirst.mockResolvedValue({
      id: "old-test-caller",
      externalId: "admin-test-some-user-id",
    });
    mockTransaction.mockResolvedValue([]);

    const { status, json } = await callPatch("new-caller", { phone: "+447768485153" });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.takeoverFrom).toBe("old-test-caller");
    expect(json.phone).toBe("+447768485153");
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  for (const role of ["EDUCATOR", "ADMIN", "SUPERADMIN"] as const) {
    it(`${role} can take over from an admin-test caller`, async () => {
      mockRequireAuth.mockResolvedValue(makeAuth(role));
      mockResolveScope.mockResolvedValue({ scopedCallerId: "new-caller" });
      mockCallerFindUnique.mockResolvedValue({ id: "new-caller", phone: null });
      mockCallerFindFirst.mockResolvedValue({
        id: "old-test-caller",
        externalId: "admin-test-x",
      });
      mockTransaction.mockResolvedValue([]);

      const { status } = await callPatch("new-caller", { phone: "+447768485153" });
      expect(status).toBe(200);
    });
  }

  it("STUDENT session canNOT take over even when the holder is an admin-test caller (no escalation)", async () => {
    mockRequireAuth.mockResolvedValue(makeAuth("STUDENT"));
    mockResolveScope.mockResolvedValue({ scopedCallerId: "new-caller" });
    mockCallerFindUnique.mockResolvedValue({ id: "new-caller", phone: null });
    mockCallerFindFirst.mockResolvedValue({
      id: "old-test-caller",
      externalId: "admin-test-x",
    });

    const { status, json } = await callPatch("new-caller", { phone: "+447768485153" });

    expect(status).toBe(409);
    expect(json.error).toMatch(/already in use/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("OPERATOR+ cannot take over from a REAL caller (externalId is not 'admin-test-*')", async () => {
    mockRequireAuth.mockResolvedValue(makeAuth("OPERATOR"));
    mockResolveScope.mockResolvedValue({ scopedCallerId: "new-caller" });
    mockCallerFindUnique.mockResolvedValue({ id: "new-caller", phone: null });
    mockCallerFindFirst.mockResolvedValue({
      id: "real-caller",
      externalId: "join-12345",
    });

    const { status, json } = await callPatch("new-caller", { phone: "+447768485153" });

    expect(status).toBe(409);
    expect(json.error).toMatch(/already in use/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("OPERATOR+ cannot take over from a caller with NULL externalId", async () => {
    mockRequireAuth.mockResolvedValue(makeAuth("ADMIN"));
    mockResolveScope.mockResolvedValue({ scopedCallerId: "new-caller" });
    mockCallerFindUnique.mockResolvedValue({ id: "new-caller", phone: null });
    mockCallerFindFirst.mockResolvedValue({
      id: "legacy-caller",
      externalId: null,
    });

    const { status } = await callPatch("new-caller", { phone: "+447768485153" });
    expect(status).toBe(409);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("no conflict → unchanged 200 path (no takeover branch)", async () => {
    mockRequireAuth.mockResolvedValue(makeAuth("OPERATOR"));
    mockResolveScope.mockResolvedValue({ scopedCallerId: "new-caller" });
    mockCallerFindUnique.mockResolvedValue({ id: "new-caller", phone: null });
    mockCallerFindFirst.mockResolvedValue(null);
    mockCallerUpdate.mockResolvedValue({});

    const { status, json } = await callPatch("new-caller", { phone: "+447768485153" });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.takeoverFrom).toBeUndefined();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockCallerUpdate).toHaveBeenCalledWith({
      where: { id: "new-caller" },
      data: { phone: "+447768485153" },
    });
  });
});
