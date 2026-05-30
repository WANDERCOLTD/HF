import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

import {
  getSessionCookieName,
  mintAndSetSessionCookie,
} from "@/lib/auth-session-cookie";

const encodeMock = vi.fn();

vi.mock("next-auth/jwt", () => ({
  encode: (...args: unknown[]) => encodeMock(...args),
}));

const user = {
  id: "u1",
  email: "learner@example.com",
  name: "Test Learner",
  role: "STUDENT",
};

describe("auth-session-cookie", () => {
  beforeEach(() => {
    encodeMock.mockReset();
    encodeMock.mockResolvedValue("mock-jwt");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses __Secure-authjs.session-token in production for BOTH cookie name and salt", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");

    expect(getSessionCookieName()).toBe("__Secure-authjs.session-token");

    const response = NextResponse.json({ ok: true });
    await mintAndSetSessionCookie(response, user);

    const encodeArgs = encodeMock.mock.calls[0][0];
    expect(encodeArgs.salt).toBe("__Secure-authjs.session-token");
    expect(encodeArgs.secret).toBe("test-secret");

    const cookie = response.cookies.get("__Secure-authjs.session-token");
    expect(cookie?.value).toBe("mock-jwt");
    expect(cookie?.secure).toBe(true);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
  });

  it("uses bare authjs.session-token in development for BOTH cookie name and salt", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");

    expect(getSessionCookieName()).toBe("authjs.session-token");

    const response = NextResponse.json({ ok: true });
    await mintAndSetSessionCookie(response, user);

    const encodeArgs = encodeMock.mock.calls[0][0];
    expect(encodeArgs.salt).toBe("authjs.session-token");

    const cookie = response.cookies.get("authjs.session-token");
    expect(cookie?.value).toBe("mock-jwt");
    expect(cookie?.secure).toBe(false);
  });

  it("salt MUST equal cookie name — regression guard for #980 silent JWE decrypt failure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");

    const response = NextResponse.json({ ok: true });
    await mintAndSetSessionCookie(response, user);

    const encodeArgs = encodeMock.mock.calls[0][0];
    expect(encodeArgs.salt).toBe(getSessionCookieName());
  });

  it("falls back to AUTH_SECRET when NEXTAUTH_SECRET is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "fallback-secret");

    const response = NextResponse.json({ ok: true });
    await mintAndSetSessionCookie(response, user);

    const encodeArgs = encodeMock.mock.calls[0][0];
    expect(encodeArgs.secret).toBe("fallback-secret");
  });

  it("throws MISSING_NEXTAUTH_SECRET when neither secret is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "");

    const response = NextResponse.json({ ok: true });
    await expect(mintAndSetSessionCookie(response, user)).rejects.toThrow(
      "MISSING_NEXTAUTH_SECRET",
    );
  });

  it("skipCookie=true returns response unchanged and does not call encode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");

    const response = NextResponse.json({ ok: true });
    const result = await mintAndSetSessionCookie(response, user, { skipCookie: true });

    expect(result).toBe(response);
    expect(encodeMock).not.toHaveBeenCalled();
    expect(response.cookies.get("__Secure-authjs.session-token")).toBeUndefined();
  });

  it("encodes the expected user payload shape (sub, id, email, name, role)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");

    const response = NextResponse.json({ ok: true });
    await mintAndSetSessionCookie(response, user);

    const encodeArgs = encodeMock.mock.calls[0][0];
    expect(encodeArgs.token).toEqual({
      sub: "u1",
      id: "u1",
      email: "learner@example.com",
      name: "Test Learner",
      role: "STUDENT",
    });
    expect(encodeArgs.maxAge).toBe(30 * 24 * 60 * 60);
  });
});
