import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { sendIdentityPinEmail } from "@/lib/email";
import { resolveMessagingProvider } from "@/lib/messaging/resolve";
import { getMessagingAdapter } from "@/lib/messaging/registry";
import type { MessagingChannel } from "@/lib/messaging/types";
import { generatePin, hashPin } from "./pin";

interface IssuePinParams {
  callerId: string;
  email: string;
  firstName?: string;
  isResend?: boolean;
  /**
   * Base URL (scheme + host + port) the learner is currently on — the email's
   * "Enter your code" button is built from this so the link lands on the same
   * environment they enrolled in. Callers (the join route + resend route)
   * derive this from `request.nextUrl.origin`. Falls back to
   * `config.app.url` when not supplied (server-to-server callers).
   */
  originUrl?: string;
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
  originUrl,
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

  // Use the request's origin when supplied so the email link lands on the
  // same environment the learner enrolled in (localhost vs Cloud Run dev vs
  // prod). #1101 hotfix: previously hardcoded to config.app.url which sent
  // localhost enrollees to dev.humanfirstfoundation.com with no session.
  const baseUrl = originUrl ?? config.app.url;
  const callerSimUrl = `${baseUrl}/x/sim/${callerId}`;

  // #1141 — dispatch via the MessagingProvider resolver. Today the
  // channel is always 'email' (SMS preference comes in a separate
  // story when an SMS adapter ships). The resolver looks up the
  // institution-scoped or SYSTEM-default row; we read its adapterKey
  // and route accordingly.
  //
  // For the email path we still call `sendIdentityPinEmail` (which
  // wraps the deployed-and-working nodemailer + Resend transport from
  // #1101). The resolver's job today is to:
  //   (a) audit which provider WOULD service this caller
  //   (b) hold the seam open for SMS without touching email behaviour
  // When SMS lands, the noop-sms adapter is swapped for a real one and
  // issueFirstCallPin's dispatch becomes a single `adapter.send(...)`
  // call. TL #1141 R4/R5 — minimal-risk path through the existing
  // PIN-email plumbing.
  const channel: MessagingChannel = "email";
  const provider = await resolveMessagingProvider({ callerId, channel });

  try {
    if (channel === "email") {
      // Email path: keep #1101's transport intact. The provider lookup
      // above is the audit hook; the actual send goes through
      // sendIdentityPinEmail unchanged.
      await sendIdentityPinEmail({
        to: email,
        firstName,
        pin,
        callerSimUrl,
        isResend,
      });
    } else {
      // SMS path: route through the adapter. With noop-sms registered
      // this currently throws NotImplementedError, which is caught
      // below — best-effort, never breaks enrolment.
      if (!provider) {
        throw new Error(`[identity-pin] no messaging provider for channel '${channel}'`);
      }
      const adapter = getMessagingAdapter(provider.adapterKey);
      await adapter.send({
        to: email,
        channel,
        secretRef: provider.secretRef,
        fromAddress: provider.fromAddress,
        subject: isResend ? `Your new sign-in code: ${pin}` : `Your sign-in code: ${pin}`,
        body: `Your code is ${pin}. Expires in 24 hours.`,
        plainTextBody: `Your code is ${pin}. Expires in 24 hours.`,
      });
    }
  } catch (err) {
    // Best-effort: messaging failure must not break enrolment. Log and move on;
    // the learner can request a resend if they don't receive the message.
    console.error(
      `[identity-pin] failed to send PIN via channel '${channel}' for caller ${callerId}`,
      err,
    );
  }

  return { challengeId: challenge.id };
}
