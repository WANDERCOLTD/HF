import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  resolveCallerScopeForReading,
  isScopeError,
} from "@/lib/learner-scope";

/**
 * @api GET /api/identity/challenge-status
 * @visibility public
 * @auth session (STUDENT+)
 * @description Whether the learner has an outstanding first-call PIN challenge
 * to satisfy before the sim page should render the chat. Used by
 * /x/sim/[callerId] to decide between FirstCallPinGate and SimChat. STUDENT
 * sessions are locked to their own caller via resolveCallerScopeForReading.
 * @query callerId string
 * @response 200 { ok: true, needsPin: boolean, locked: boolean, recipient: string | null }
 */
export async function GET(req: Request) {
  const authResult = await requireAuth("VIEWER");
  if (isAuthError(authResult)) return authResult.error;

  const url = new URL(req.url);
  const requestedCallerId = url.searchParams.get("callerId");

  const scope = await resolveCallerScopeForReading(
    authResult.session,
    requestedCallerId,
  );
  if (isScopeError(scope)) return scope.error;
  const callerId = scope.scopedCallerId;
  if (!callerId) {
    return NextResponse.json(
      { ok: true, needsPin: false, locked: false, recipient: null },
    );
  }

  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const locked = await prisma.callerIdentityChallenge.findFirst({
    where: {
      callerId,
      issuedAt: { gte: windowStart },
      lockedAt: { not: null },
    },
    select: { id: true },
  });

  const active = await prisma.callerIdentityChallenge.findFirst({
    where: { callerId, verifiedAt: null },
    orderBy: { issuedAt: "desc" },
    select: { recipient: true },
  });

  return NextResponse.json({
    ok: true,
    needsPin: Boolean(active),
    locked: Boolean(locked),
    recipient: active?.recipient ?? null,
  });
}
