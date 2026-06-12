// HF-D P1 #3 (issue #1542) — intake session cookie helper.
//
// Pins the shape of the `__hf_intake_sid` bearer cookie so a future
// change to the helper (e.g. shifting Path, dropping HttpOnly,
// loosening SameSite) trips a test rather than silently weakening
// the bearer transport.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  INTAKE_SID_COOKIE,
  setIntakeSidCookie,
  readIntakeSid,
  clearIntakeSidCookie,
} from "@/lib/intake/intake-session-cookie";

beforeEach(() => {
  // Default to non-production so tests don't accidentally couple to
  // a global env. Each test that needs production flips it locally.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("intake-session-cookie / setIntakeSidCookie", () => {
  it("sets the cookie with the canonical name", () => {
    const res = NextResponse.json({});
    setIntakeSidCookie(res, "intent-test-1234");
    const cookie = res.cookies.get(INTAKE_SID_COOKIE);
    expect(cookie?.value).toBe("intent-test-1234");
  });

  it("sets HttpOnly, SameSite=strict, Path=/api/intake/ in non-production", () => {
    const res = NextResponse.json({});
    setIntakeSidCookie(res, "intent-abc");
    const cookie = res.cookies.get(INTAKE_SID_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("strict");
    expect(cookie?.path).toBe("/api/intake/");
    expect(cookie?.secure).toBe(false); // non-production
  });

  it("sets Secure=true in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = NextResponse.json({});
    setIntakeSidCookie(res, "intent-prod");
    const cookie = res.cookies.get(INTAKE_SID_COOKIE);
    expect(cookie?.secure).toBe(true);
  });

  it("is idempotent — calling twice overwrites with the same value", () => {
    const res = NextResponse.json({});
    setIntakeSidCookie(res, "intent-1");
    setIntakeSidCookie(res, "intent-1");
    expect(res.cookies.get(INTAKE_SID_COOKIE)?.value).toBe("intent-1");
  });
});

describe("intake-session-cookie / readIntakeSid", () => {
  it("returns the cookie value when present", () => {
    const req = new NextRequest(new URL("http://localhost/api/intake/session"), {
      headers: { cookie: `${INTAKE_SID_COOKIE}=intent-xyz` },
    });
    expect(readIntakeSid(req)).toBe("intent-xyz");
  });

  it("returns null when the cookie is absent", () => {
    const req = new NextRequest(new URL("http://localhost/api/intake/session"));
    expect(readIntakeSid(req)).toBeNull();
  });

  it("returns null when a different cookie is set", () => {
    const req = new NextRequest(new URL("http://localhost/api/intake/session"), {
      headers: { cookie: "some-other=value" },
    });
    expect(readIntakeSid(req)).toBeNull();
  });
});

describe("intake-session-cookie / clearIntakeSidCookie", () => {
  it("writes an empty value with Max-Age 0", () => {
    const res = NextResponse.json({});
    clearIntakeSidCookie(res);
    const cookie = res.cookies.get(INTAKE_SID_COOKIE);
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
  });

  it("preserves Path so the browser actually clears the cookie at the same scope", () => {
    const res = NextResponse.json({});
    clearIntakeSidCookie(res);
    const cookie = res.cookies.get(INTAKE_SID_COOKIE);
    expect(cookie?.path).toBe("/api/intake/");
  });
});
