// Opaque session-cookie bearer for the EnrollmentIntake surface.
//
// HF-D P1 #3 (audit closeout commit `715589c1`): the 8 intake routes
// previously carried `intentId` as a URL path or body bearer. Every
// request put the secret into Cloud Run / Cloudflare access logs,
// browser history, Referer headers, and (for the JSONL download) the
// saved filename. The audit doc enumerates the four leakage vectors
// (T1–T4) in `docs/audit/HF-D-evidence-pii-intentid-bearer.md`.
//
// This module is the structural fix: the intentId travels as a
// httpOnly + SameSite=Strict + Secure (in prod) cookie scoped to
// `/api/intake/`. Routes read the cookie via `readIntakeSid` and
// branch on the three terminal states (missing → 401, evicted → 410,
// present → 200).
//
// Path scope locked at `/api/intake/` per Tech Lead amendment on
// issue #1542. Every authenticated fetch on this surface targets
// `/api/intake/*`; the `/intake/done` server-rendered page consults
// the cookie via Next.js `cookies()` (server-side, unaffected by
// browser path-scoping rules).
//
// `intentId` is `intent-${randomUUID()}` from
// `lib/intake/session-store.ts::openSession()` — 122 bits of entropy.
// The cookie carries it verbatim as the opaque value; brute force is
// not the threat model (audit §"Token shape"). Signing/encrypting it
// is a defence-in-depth follow-on that earns its keep once Phase 1.5
// PrismaEventStore persists sessions to disk.

import type { NextRequest, NextResponse } from "next/server";

/**
 * Cookie name for the EnrollmentIntake session bearer. Distinct from
 * the NextAuth `authjs.session-token` cookie so the two coexist
 * cleanly on the same response (e.g. `/api/intake/v2/start` mints
 * both — NextAuth for the freshly-created learner User, intake-sid
 * for the in-flight intake session).
 */
export const INTAKE_SID_COOKIE = "__hf_intake_sid";

/**
 * Path scope: every reader route lives under `/api/intake/*`. The
 * client pages (`/intake/done`, `/intake/v2/[token]`) are
 * server-rendered Next.js routes that read the cookie via
 * `next/headers::cookies()` server-side, not via browser-supplied
 * `Cookie` headers, so the narrow path scope is sufficient.
 */
const INTAKE_COOKIE_PATH = "/api/intake/";

const isProduction = (): boolean => process.env.NODE_ENV === "production";

/**
 * Write the intake session bearer cookie onto `response`. Idempotent —
 * calling twice in one response overwrites with the same value, which
 * is the desired shape for routes that may set the cookie on a
 * fast-path before deciding to set it again on a slow path.
 */
export function setIntakeSidCookie(
  response: NextResponse,
  intentId: string,
): void {
  response.cookies.set(INTAKE_SID_COOKIE, intentId, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "strict",
    path: INTAKE_COOKIE_PATH,
  });
}

/**
 * Read the intake session bearer from the request cookie jar. Returns
 * `null` when the cookie is absent — the caller picks the response
 * shape (401 for missing-cookie, 410 for present-but-evicted).
 */
export function readIntakeSid(request: NextRequest): string | null {
  return request.cookies.get(INTAKE_SID_COOKIE)?.value ?? null;
}

/**
 * Erase the intake session bearer cookie. Called after a successful
 * `/api/join/[token]` hand-off so the now-stale intentId stops
 * accompanying every subsequent request.
 */
export function clearIntakeSidCookie(response: NextResponse): void {
  response.cookies.set(INTAKE_SID_COOKIE, "", {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "strict",
    path: INTAKE_COOKIE_PATH,
    maxAge: 0,
  });
}
