import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  resolveCallerScopeForReading,
  isScopeError,
} from "@/lib/learner-scope";
import { config } from "@/lib/config";
import { verifyPinHash } from "@/lib/identity/pin";

const bodySchema = z
  .object({
    callerId: z.string().min(1),
    pin: z.string().length(6).regex(/^\d{6}$/),
  })
  .strict();

/**
 * @api POST /api/identity/verify-pin
 * @visibility public
 * @auth session (STUDENT+)
 * @description Verify a learner's first-call PIN. STUDENT sessions are locked
 * to their own caller via resolveCallerScopeForReading — body callerId is
 * ignored for STUDENTs. Lockout aggregates failed attempts across the caller's
 * challenges in the last 24h.
 * @response 200 { ok: true } — PIN correct, challenge marked verified
 * @response 200 { ok: false, expired: true } — PIN matched but past TTL; does NOT count toward lockout
 * @response 200 { ok: false, locked: true } — caller is in 24h lockout window
 * @response 200 { ok: false, attemptsRemaining: number } — wrong PIN
 * @response 200 { ok: false, noActiveChallenge: true } — no challenge to verify (request resend)
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

  const pinConfig = config.security.identityPin;
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Lockout check — any challenge in the last 24h with a lockedAt timestamp
  // means the caller is locked regardless of which challenge they're trying.
  const locked = await prisma.callerIdentityChallenge.findFirst({
    where: {
      callerId,
      issuedAt: { gte: windowStart },
      lockedAt: { not: null },
    },
    select: { id: true },
  });
  if (locked) {
    return NextResponse.json({ ok: false, locked: true });
  }

  // Most recent unverified challenge — older ones are moot (resends invalidate
  // by superseding; we always verify against the latest).
  const challenge = await prisma.callerIdentityChallenge.findFirst({
    where: { callerId, verifiedAt: null },
    orderBy: { issuedAt: "desc" },
    select: {
      id: true,
      pinHash: true,
      expiresAt: true,
      attemptCount: true,
    },
  });
  if (!challenge) {
    return NextResponse.json({ ok: false, noActiveChallenge: true });
  }

  // Hash compare is constant-time (bcryptjs ~111ms for both match and miss),
  // so the expired/wrong branch below does not leak via timing. TL review.
  const matches = await verifyPinHash(parsed.data.pin, challenge.pinHash);

  if (matches) {
    if (challenge.expiresAt.getTime() < Date.now()) {
      // Right PIN but expired — distinct response, does NOT increment attemptCount.
      return NextResponse.json({ ok: false, expired: true });
    }
    await prisma.callerIdentityChallenge.update({
      where: { id: challenge.id },
      data: { verifiedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  // Wrong PIN — increment attempt counter; aggregate across last 24h.
  await prisma.callerIdentityChallenge.update({
    where: { id: challenge.id },
    data: { attemptCount: { increment: 1 } },
  });

  const totalAttempts = await prisma.callerIdentityChallenge.aggregate({
    where: { callerId, issuedAt: { gte: windowStart } },
    _sum: { attemptCount: true },
  });
  const usedAttempts = totalAttempts._sum.attemptCount ?? 0;

  if (usedAttempts >= pinConfig.maxAttempts) {
    await prisma.callerIdentityChallenge.update({
      where: { id: challenge.id },
      data: { lockedAt: new Date() },
    });
    return NextResponse.json({ ok: false, locked: true });
  }

  return NextResponse.json({
    ok: false,
    attemptsRemaining: Math.max(0, pinConfig.maxAttempts - usedAttempts),
  });
}
