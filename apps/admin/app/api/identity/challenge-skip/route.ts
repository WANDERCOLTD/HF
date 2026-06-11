import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

const bodySchema = z
  .object({
    callerId: z.string().min(1),
  })
  .strict();

/**
 * @operator-surface yes
 *
 * @api POST /api/identity/challenge-skip
 * @visibility internal (OPERATOR+)
 * @auth session (OPERATOR / ADMIN / SUPERADMIN)
 * @description Admin escape hatch: mark a caller's most-recent
 * unverified `CallerIdentityChallenge` as verified WITHOUT requiring
 * the 6-digit PIN. The intended use is admins testing or supporting a
 * learner on the first-call sign-in screen — same end state as a
 * correct PIN entry (challenge.verifiedAt set, FirstCallPinGate
 * onVerified path runs, the rest of the flow continues).
 *
 * Strictly OPERATOR+. `requireAuth("OPERATOR")` admits OPERATOR,
 * EDUCATOR (same level), ADMIN, and SUPERADMIN; refuses STUDENT,
 * VIEWER, TESTER, DEMO with 401.
 *
 * Lockout: an active 24h lockout does NOT block the skip (the
 * skip's whole point is to bypass auth friction). The audit row
 * does record the unlock, however.
 *
 * Audit: emits a `[identity/skip]` console.warn with the admin's
 * userId, the target callerId, and a timestamp so the action is
 * visible in dev/staging/prod logs. A formal AuditLog entry could
 * be added once we have a shared audit-event table — out of scope.
 *
 * @response 200 { ok: true, challengeId: string }
 * @response 200 { ok: false, noActiveChallenge: true } — no unverified challenge to skip; admin should request a fresh resend first
 * @response 400 { ok: false, error: string }
 * @response 401 — caller not authenticated or not OPERATOR+
 */
export async function POST(req: Request) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request body" },
      { status: 400 },
    );
  }
  const { callerId } = parsed.data;

  const challenge = await prisma.callerIdentityChallenge.findFirst({
    where: { callerId, verifiedAt: null },
    orderBy: { issuedAt: "desc" },
    select: { id: true },
  });
  if (!challenge) {
    return NextResponse.json({ ok: false, noActiveChallenge: true });
  }

  await prisma.callerIdentityChallenge.update({
    where: { id: challenge.id },
    data: { verifiedAt: new Date() },
  });

  console.warn(
    `[identity/skip] OPERATOR+ session marked challenge ${challenge.id} verified — admin=${authResult.session.user.id} (${authResult.session.user.role}) caller=${callerId} at ${new Date().toISOString()}`,
  );

  return NextResponse.json({ ok: true, challengeId: challenge.id });
}
