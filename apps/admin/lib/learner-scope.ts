/**
 * Learner-Scope Helper
 *
 * Resolves which callerId an authenticated session is permitted to read on
 * admin-style routes that accept `?callerId=` (currently /api/calls,
 * /api/goals, /api/memories — see #977).
 *
 * Rule: STUDENT-level sessions are locked to their own LEARNER Caller. The
 * `?callerId=` query param is ignored for STUDENTs. OPERATOR+ sessions
 * (and other non-STUDENT roles admitted by `requireAuth("VIEWER")`) keep
 * the legacy "admin browsing" behaviour: requested callerId is honoured,
 * `null` means no filter.
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
