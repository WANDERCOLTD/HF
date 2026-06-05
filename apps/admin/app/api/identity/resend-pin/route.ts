import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  resolveCallerScopeForReading,
  isScopeError,
} from "@/lib/learner-scope";
import { config } from "@/lib/config";
import { issueFirstCallPin } from "@/lib/identity/issue-pin";

const bodySchema = z.object({ callerId: z.string().min(1) }).strict();

/**
 * @api POST /api/identity/resend-pin
 * @visibility public
 * @auth session (STUDENT+)
 * @description Re-issue a first-call PIN to the caller's on-file email. Caps
 * at IDENTITY_PIN_MAX_RESENDS (default 3) in any 24h window — the cap query
 * filters resendCount > 0 so the initial enrolment issuance does not count.
 * Cooldown of IDENTITY_PIN_RESEND_COOLDOWN_SECONDS (default 60) between
 * resends. Resending does NOT clear lockout — the learner can hold a fresh
 * PIN, but cannot verify until 24h elapses or an admin unlocks.
 * @response 200 { ok: true } — fresh PIN sent
 * @response 200 { ok: false, resendCapReached: true } — 3 resends already today
 * @response 200 { ok: false, cooldownSecondsRemaining: number } — within 60s window
 * @response 200 { ok: false, noActiveCaller: true } — caller has no email on file
 * @response 400 { ok: false, error: string } — invalid body
 */
export async function POST(req: Request) {
  const authResult = await requireAuth("VIEWER");
  if (isAuthError(authResult)) return authResult.error;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  const scope = await resolveCallerScopeForReading(
    authResult.session,
    parsed.data.callerId,
  );
  if (isScopeError(scope)) return scope.error;
  const callerId = scope.scopedCallerId;
  if (!callerId) {
    return NextResponse.json(
      { ok: false, error: "Caller scope not resolved" },
      { status: 400 },
    );
  }

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { email: true, name: true },
  });
  if (!caller || !caller.email) {
    return NextResponse.json({ ok: false, noActiveCaller: true });
  }

  const pinConfig = config.security.identityPin;
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Cap query: count ONLY resend-issued challenges in last 24h. The initial
  // enrolment issuance has resendCount = 0 and is excluded by the filter.
  // (TL review: without this filter the learner would get 2 resends, not 3.)
  const resendsUsed = await prisma.callerIdentityChallenge.count({
    where: {
      callerId,
      issuedAt: { gte: windowStart },
      resendCount: { gt: 0 },
    },
  });
  if (resendsUsed >= pinConfig.maxResendsPer24h) {
    return NextResponse.json({ ok: false, resendCapReached: true });
  }

  // Cooldown — defence-in-depth alongside the client-side button countdown.
  const cooldownStart = new Date(
    Date.now() - pinConfig.resendCooldownSeconds * 1000,
  );
  const lastResend = await prisma.callerIdentityChallenge.findFirst({
    where: {
      callerId,
      issuedAt: { gte: cooldownStart },
      resendCount: { gt: 0 },
    },
    orderBy: { issuedAt: "desc" },
    select: { issuedAt: true },
  });
  if (lastResend) {
    const elapsed = (Date.now() - lastResend.issuedAt.getTime()) / 1000;
    const remaining = Math.ceil(pinConfig.resendCooldownSeconds - elapsed);
    return NextResponse.json({
      ok: false,
      cooldownSecondsRemaining: Math.max(1, remaining),
    });
  }

  const firstName = caller.name?.trim().split(/\s+/)[0];
  // originUrl from the resend request so the new PIN email's button URL
  // matches where the learner is sitting (same hotfix as the join route).
  await issueFirstCallPin({
    callerId,
    email: caller.email,
    firstName,
    isResend: true,
    originUrl: new URL(req.url).origin,
  });

  return NextResponse.json({ ok: true });
}
