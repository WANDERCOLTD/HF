import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";
import { mintAndSetSessionCookie } from "@/lib/auth-session-cookie";
import { issueFirstCallPin } from "@/lib/identity/issue-pin";
import { enrollCallerInCohortPlaybooks } from "@/lib/enrollment";

export const runtime = "nodejs";

const bodySchema = z.object({
  classroomToken: z.string().min(1).max(120),
  /** Free-form contact field — auto-detected as email (contains @) or
   *  phone (else). Phone-based is rejected for now since SMS is stubbed
   *  (#1133); a clear error surfaces from this route. */
  contact: z.string().min(1).max(256),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @api POST /api/intake/v2/start
 * @visibility public
 * @auth none
 * @description V2 auth-first enrolment kickoff (#1141 Story 2). Takes a
 *   cohort token + a single contact field, creates a stub User + Caller
 *   for the cohort, issues a first-call PIN via the messaging-provider
 *   resolver (#1141 Story 3 — today: email-resend; tomorrow: SMS), and
 *   returns { callerId } so the client can navigate to the gate +
 *   chat-to-complete flow.
 *
 *   For now phone is detected but REJECTED with a clear "use email"
 *   message — SMS adapter stubbed (#1133). When SMS lands this route
 *   accepts both.
 *
 *   Existing users (matching email): the user signed up before. Allowed
 *   per epic spec — we attach them to the cohort if they aren't already
 *   in it, issue a fresh PIN to their on-file email. PIN gate flow then
 *   proves they own the inbox, chat-to-complete fills in any missing
 *   profile fields.
 *
 * @body { classroomToken, contact }
 * @response 201 { ok: true, callerId, channel: 'email', gatePath: '/intake/v2/<token>/<callerId>' }
 * @response 400 { ok: false, error } — phone supplied, invalid email, expired token
 * @response 404 { ok: false, error: "Invalid or expired classroom token" }
 */
export async function POST(request: Request) {
  const rl = checkRateLimit(getClientIP(request as never), "intake-v2-start");
  if (!rl.ok) return rl.error;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid body" },
      { status: 400 },
    );
  }

  const trimmedContact = body.contact.trim();
  const isEmail = trimmedContact.includes("@");
  if (!isEmail) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Phone-based sign-in is coming soon. For now please enter an email address.",
        kind: "phone-not-supported",
      },
      { status: 400 },
    );
  }
  if (!EMAIL_RE.test(trimmedContact)) {
    return NextResponse.json(
      { ok: false, error: "That doesn't look like a valid email address." },
      { status: 400 },
    );
  }
  const email = trimmedContact.toLowerCase();

  // Resolve the cohort + verify the token is active.
  const cohort = await prisma.cohortGroup.findUnique({
    where: { joinToken: body.classroomToken },
    select: {
      id: true,
      isActive: true,
      joinTokenExp: true,
      domainId: true,
      institutionId: true,
    },
  });
  if (!cohort || !cohort.isActive) {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired classroom token" },
      { status: 404 },
    );
  }
  if (cohort.joinTokenExp && new Date(cohort.joinTokenExp) < new Date()) {
    return NextResponse.json(
      { ok: false, error: "This classroom link has expired" },
      { status: 410 },
    );
  }

  // Existing-user path: attach to cohort if not already.
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, displayName: true },
  });

  let callerId: string;
  let userId: string;

  const requestUrl = new URL(request.url);
  const originUrl = `${requestUrl.protocol}//${requestUrl.host}`;

  if (existingUser) {
    userId = existingUser.id;

    // Already a member of this cohort? Find or create the Caller.
    const existingMembership = await prisma.callerCohortMembership.findFirst({
      where: { cohortGroupId: cohort.id, caller: { userId: existingUser.id } },
      select: { callerId: true },
    });
    const directCaller = !existingMembership
      ? await prisma.caller.findFirst({
          where: { userId: existingUser.id, cohortGroupId: cohort.id },
          select: { id: true },
        })
      : null;
    callerId = existingMembership?.callerId ?? directCaller?.id ?? "";

    if (!callerId) {
      // Existing user, new cohort — create the Caller, mirror /join path 2.
      const newCaller = await prisma.caller.create({
        data: {
          name: existingUser.name ?? email,
          email,
          role: "LEARNER",
          userId: existingUser.id,
          domainId: cohort.domainId,
          cohortGroupId: cohort.id,
          externalId: `intake-v2-${existingUser.id}-${cohort.id}`,
        },
        select: { id: true },
      });
      callerId = newCaller.id;
      await prisma.callerCohortMembership.create({
        data: { callerId, cohortGroupId: cohort.id },
      });
      if (cohort.domainId) {
        await enrollCallerInCohortPlaybooks(
          callerId,
          cohort.id,
          cohort.domainId,
          "intake-v2",
        );
      }
    }
  } else {
    // New user: create both User + Caller atomically. Name + displayName
    // are placeholders (the email's local-part). Real values arrive via
    // the chat-to-complete step + the /join PATCH that the chat's
    // commit-redirect triggers.
    const placeholderName = email.split("@")[0] || "Learner";
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: placeholderName,
          displayName: placeholderName,
          role: "STUDENT",
          emailVerified: new Date(),
          isActive: true,
          assignedDomainId: cohort.domainId,
          institutionId: cohort.institutionId,
        },
      });
      const caller = await tx.caller.create({
        data: {
          name: placeholderName,
          email,
          role: "LEARNER",
          userId: user.id,
          domainId: cohort.domainId,
          cohortGroupId: cohort.id,
          externalId: `intake-v2-${user.id}`,
        },
      });
      await tx.callerCohortMembership.create({
        data: { callerId: caller.id, cohortGroupId: cohort.id },
      });
      return { userId: user.id, callerId: caller.id };
    });
    userId = result.userId;
    callerId = result.callerId;
    if (cohort.domainId) {
      await enrollCallerInCohortPlaybooks(
        callerId,
        cohort.id,
        cohort.domainId,
        "intake-v2",
      );
    }
  }

  // Issue PIN via the resolver (#1141 — today: email; tomorrow: caller's
  // preferredContactMethod). Best-effort — SMTP failure logs but doesn't
  // break the flow; learner hits Resend in the gate.
  await issueFirstCallPin({
    callerId,
    email,
    firstName: existingUser?.displayName ?? existingUser?.name ?? undefined,
    originUrl,
  });

  // Mint a session cookie so the gate's verify-pin call has an auth
  // context (#1101 STUDENT-scope guard). Without this, the verify
  // would 401 + redirect to /login — fatal UX for an anon learner.
  const userRow = await prisma.user.findUnique({ where: { id: userId } });
  const response = NextResponse.json(
    {
      ok: true,
      callerId,
      channel: "email",
      gatePath: `/intake/v2/${body.classroomToken}/${callerId}`,
    },
    { status: 201 },
  );
  try {
    if (userRow) {
      await mintAndSetSessionCookie(response, userRow);
    }
  } catch {
    // Auth secret missing — non-fatal here, but the gate will likely
    // 401. The downstream error message is clearer than a 500 from
    // this route.
  }
  return response;
}
