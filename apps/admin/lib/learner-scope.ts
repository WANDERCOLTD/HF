/**
 * Learner-Scope Helper
 *
 * Resolves which callerId an authenticated session is permitted to read on
 * admin-style routes that accept `?callerId=` (currently /api/calls,
 * /api/goals, /api/memories — see #977 — plus the B7 query-param routes
 * /api/pipeline/runs, /api/prompt/compose-from-specs, /api/metering/events).
 *
 * Rule: STUDENT-level sessions are locked to their own LEARNER Caller. The
 * `?callerId=` query param is ignored for STUDENTs. OPERATOR+ sessions
 * (and other non-STUDENT roles admitted by `requireAuth("VIEWER")`) keep
 * the legacy "admin browsing" behaviour: requested callerId is honoured,
 * `null` means no filter.
 *
 * For routes that fetch a resource by id and then need to verify a STUDENT
 * owns it (e.g. /api/calls/[callId]), use `studentAllowedToReadCaller`
 * instead — it's a synchronous JWT-claim check with no DB hit.
 */

import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type ScopeResult =
  | { scopedCallerId: string | null }
  | { error: NextResponse };

export function isScopeError(
  result: ScopeResult,
): result is { error: NextResponse } {
  return "error" in result;
}

export async function resolveCallerScopeForReading(
  session: Session,
  requestedCallerId: string | null,
): Promise<ScopeResult> {
  if (session.user.role !== "STUDENT") {
    return { scopedCallerId: requestedCallerId };
  }

  // Fast path: A5 stamps learnerCallerId on the JWT at sign-in, so no DB
  // hit is needed for STUDENT scope resolution. Pre-A5 sessions fall
  // through to the legacy lookup below until the 5-min refresh backfills.
  if (session.user.learnerCallerId) {
    return { scopedCallerId: session.user.learnerCallerId };
  }

  const caller = await prisma.caller.findFirst({
    where: { userId: session.user.id, role: "LEARNER" },
    select: { id: true },
  });

  if (!caller) {
    return {
      error: NextResponse.json(
        { ok: false, error: "No learner profile found" },
        { status: 403 },
      ),
    };
  }

  return { scopedCallerId: caller.id };
}

/**
 * Returns false iff the session is a STUDENT and `resourceCallerId` does
 * not match their owned LEARNER caller. Used by routes that fetch a
 * resource by id (e.g. /api/calls/[callId]) and need a post-lookup
 * authorisation check — pairs naturally with the lookup's existing
 * Promise.all rather than adding a second DB hit.
 *
 * Returns true for non-STUDENT roles (passthrough — admin browsing).
 * Returns false for STUDENT with a null `learnerCallerId` claim (defence
 * in depth — a STUDENT without a LEARNER profile shouldn't read any
 * caller's data).
 */
export function studentAllowedToReadCaller(
  session: Session,
  resourceCallerId: string | null | undefined,
): boolean {
  if (session.user.role !== "STUDENT") return true;
  if (!resourceCallerId) return false;
  return resourceCallerId === session.user.learnerCallerId;
}

/** Shared 403 response for the inline STUDENT-owns-resource check. */
export function callerScopeMismatchResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Forbidden — caller scope mismatch" },
    { status: 403 },
  );
}
