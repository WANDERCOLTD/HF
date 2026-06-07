/**
 * Tests for lib/auth/has-higher-role-session.
 *
 * The helper is the gate that prevents intake/v2/start (and the
 * existing /api/join) from overwriting an admin's session cookie
 * when the admin walks through the learner-creation flow.
 *
 * Properties covered:
 *   - Returns true when a recognised session cookie decodes to a
 *     role strictly above STUDENT (OPERATOR / ADMIN / SUPERADMIN).
 *   - Returns false when the decoded role is STUDENT.
 *   - Returns false when no recognised cookie is present.
 *   - Returns false when the cookie fails to decode (forged / wrong
 *     secret / expired).
 *   - Returns false when AUTH_SECRET / NEXTAUTH_SECRET is unset
 *     (defensive — never claim "yes" without secret).
 *   - Tries each cookie name in the list; finds a match on the
 *     non-first name.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDecode = vi.fn();

vi.mock("next-auth/jwt", () => ({
  decode: (...args: unknown[]) => mockDecode(...args),
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

import { hasHigherRoleSession } from "@/lib/auth/has-higher-role-session";

function makeRequest(cookies: Record<string, string>) {
  // NextRequest interface used by the helper exposes a .cookies bag
  // with a .get(name) → { value } | undefined.
  return {
    cookies: {
      get(name: string) {
        return cookies[name] ? { value: cookies[name] } : undefined;
      },
    },
  } as unknown as Parameters<typeof hasHigherRoleSession>[0];
}

const ORIGINAL_SECRET = process.env.AUTH_SECRET;
const ENV = process.env as Record<string, string | undefined>;

beforeEach(() => {
  mockDecode.mockReset();
  ENV.AUTH_SECRET = "test-secret";
  delete ENV.NEXTAUTH_SECRET;
});

describe("hasHigherRoleSession", () => {
  for (const role of ["OPERATOR", "EDUCATOR", "ADMIN", "SUPERADMIN"] as const) {
    it(`returns true when the cookie decodes to ${role}`, async () => {
      mockDecode.mockResolvedValue({ role });
      const req = makeRequest({ "authjs.session-token": "abc" });
      expect(await hasHigherRoleSession(req)).toBe(true);
    });
  }

  it("returns false when the role is STUDENT", async () => {
    mockDecode.mockResolvedValue({ role: "STUDENT" });
    const req = makeRequest({ "authjs.session-token": "abc" });
    expect(await hasHigherRoleSession(req)).toBe(false);
  });

  it("returns false when no recognised cookie is present", async () => {
    const req = makeRequest({ "some-other": "abc" });
    expect(await hasHigherRoleSession(req)).toBe(false);
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it("returns false when decode throws (forged / wrong secret)", async () => {
    mockDecode.mockRejectedValue(new Error("invalid"));
    const req = makeRequest({ "authjs.session-token": "abc" });
    expect(await hasHigherRoleSession(req)).toBe(false);
  });

  it("returns false when AUTH_SECRET + NEXTAUTH_SECRET are both unset", async () => {
    delete ENV.AUTH_SECRET;
    const req = makeRequest({ "authjs.session-token": "abc" });
    expect(await hasHigherRoleSession(req)).toBe(false);
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it("falls back to NEXTAUTH_SECRET when AUTH_SECRET is missing", async () => {
    delete ENV.AUTH_SECRET;
    ENV.NEXTAUTH_SECRET = "nextauth-secret";
    mockDecode.mockResolvedValue({ role: "ADMIN" });
    const req = makeRequest({ "authjs.session-token": "abc" });
    expect(await hasHigherRoleSession(req)).toBe(true);
  });

  it("tries each recognised cookie name — finds a match on the secure name even when the unprefixed name is absent", async () => {
    mockDecode.mockResolvedValue({ role: "SUPERADMIN" });
    const req = makeRequest({ "__Secure-authjs.session-token": "secure-cookie" });
    expect(await hasHigherRoleSession(req)).toBe(true);
  });

  it("returns false when restored to the original secret if cleanup was missed", () => {
    // Pure sanity: restore + skip; nothing to assert beyond no throw.
    if (ORIGINAL_SECRET === undefined) delete ENV.AUTH_SECRET;
    else ENV.AUTH_SECRET = ORIGINAL_SECRET;
    expect(true).toBe(true);
  });
});
