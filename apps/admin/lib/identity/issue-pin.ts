import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { sendIdentityPinEmail } from "@/lib/email";
import { generatePin, hashPin } from "./pin";

interface IssuePinParams {
  callerId: string;
  email: string;
  firstName?: string;
  isResend?: boolean;
}

/**
 * Issue a fresh first-call PIN for a caller. Creates a CallerIdentityChallenge
 * row, then best-effort emails the PIN. Email failure is logged but does NOT
 * throw — callers (the join route) must not roll back Caller creation if SMTP
 * is down. (#1101 TL review.)
 *
 * When `isResend` is true, increments `resendCount` on the new challenge row
 * and uses the resend subject-line variant in the email. The cap query at
 * /api/identity/resend-pin uses `resendCount > 0` to ignore initial issuance.
 */
export async function issueFirstCallPin({
  callerId,
  email,
  firstName,
  isResend = false,
}: IssuePinParams): Promise<{ challengeId: string }> {
  const pin = generatePin();
  const pinHash = await hashPin(pin);

  const ttlMs = config.security.identityPin.ttlHours * 60 * 60 * 1000;
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlMs);

  const challenge = await prisma.callerIdentityChallenge.create({
    data: {
      callerId,
      pinHash,
      channel: "email",
      recipient: email,
      issuedAt,
      expiresAt,
      resendCount: isResend ? 1 : 0,
      lastResentAt: isResend ? issuedAt : null,
    },
    select: { id: true },
  });

  const callerSimUrl = `${config.app.url}/x/sim/${callerId}`;

  try {
    await sendIdentityPinEmail({
      to: email,
      firstName,
      pin,
      callerSimUrl,
      isResend,
    });
  } catch (err) {
    // Best-effort: SMTP failure must not break enrolment. Log and move on;
    // the learner can request a resend if they don't receive the email.
    console.error(
      `[identity-pin] failed to send PIN email for caller ${callerId}`,
      err,
    );
  }

  return { challengeId: challenge.id };
}
