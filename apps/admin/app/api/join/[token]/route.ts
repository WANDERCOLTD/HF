import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decode } from "next-auth/jwt";
import { validateBody, joinPostSchema } from "@/lib/validation";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";
import { enrollCaller, enrollCallerInCohortPlaybooks } from "@/lib/enrollment";
import { applySkipOnboarding } from "@/lib/enrollment/skip-onboarding";
import { mintAndSetSessionCookie } from "@/lib/auth-session-cookie";
import { ROLE_LEVEL } from "@/lib/roles";
import { issueFirstCallPin } from "@/lib/identity/issue-pin";
import type { UserRole } from "@prisma/client";

const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

/** Check if the request already has a session with role above STUDENT */
async function hasHigherRoleSession(request: NextRequest): Promise<boolean> {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) return false;
  for (const name of SESSION_COOKIE_NAMES) {
    const cookie = request.cookies.get(name);
    if (!cookie) continue;
    try {
      const token = await decode({ token: cookie.value, secret, salt: name });
      const role = token?.role as UserRole | undefined;
      if (role && ROLE_LEVEL[role] > ROLE_LEVEL.STUDENT) return true;
    } catch { /* invalid token — continue */ }
  }
  return false;
}

function missingSecretResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Server configuration error" },
    { status: 500 },
  );
}

/** Separate rate-limit key for GET (token probing) vs POST (account creation) */
const RATE_LIMIT_KEY_VERIFY = "join-verify";

/**
 * @api GET /api/join/[token]
 * @visibility public
 * @auth none
 * @description Verify a classroom/community join token. Returns group info if valid.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const rl = checkRateLimit(getClientIP(request), RATE_LIMIT_KEY_VERIFY);
  if (!rl.ok) return rl.error;

  const { token } = await params;

  const cohort = await prisma.cohortGroup.findUnique({
    where: { joinToken: token },
    select: {
      id: true,
      name: true,
      isActive: true,
      joinTokenExp: true,
      domain: { select: { name: true, kind: true, onboardingWelcome: true } },
      owner: { select: { name: true } },
      institution: {
        select: {
          name: true,
          logoUrl: true,
          primaryColor: true,
          secondaryColor: true,
          welcomeMessage: true,
        },
      },
      _count: { select: { members: true } },
    },
  });

  if (!cohort || !cohort.isActive) {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired join link" },
      { status: 404 }
    );
  }

  // Check expiry
  if (cohort.joinTokenExp && new Date(cohort.joinTokenExp) < new Date()) {
    return NextResponse.json(
      { ok: false, error: "This join link has expired" },
      { status: 410 }
    );
  }

  return NextResponse.json({
    ok: true,
    classroom: {
      name: cohort.name,
      domain: cohort.domain.name,
      teacher: cohort.owner.name ?? "Your teacher",
      memberCount: cohort._count.members,
      institutionName: cohort.institution?.name ?? null,
      institutionLogo: cohort.institution?.logoUrl ?? null,
      institutionPrimaryColor: cohort.institution?.primaryColor ?? null,
      institutionWelcome: cohort.institution?.welcomeMessage ?? null,
      domainWelcome: cohort.domain.onboardingWelcome ?? null,
      isCommunity: cohort.domain.kind === "COMMUNITY",
    },
  });
}

/**
 * @api POST /api/join/[token]
 * @visibility public
 * @auth none
 * @description Accept a classroom join link. Creates User + Caller + sets session.
 * @body firstName string (required)
 * @body lastName string (required)
 * @body email string (required)
 * @body playbookId string (optional) — enroll in a specific course instead of all cohort playbooks
 * @body skipOnboarding boolean (optional) — skip onboarding wizard + surveys
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const rl = checkRateLimit(getClientIP(request), "join");
  if (!rl.ok) return rl.error;

  const { token } = await params;
  const body = await request.json();
  const v = validateBody(joinPostSchema, body);
  if (!v.ok) return v.error;
  const { firstName, lastName, email, ageRange, playbookId, skipOnboarding, phone } = v.data;
  // E.164-ish normalisation: strip spaces / dashes / parens. Full
  // validation lives in the just-in-time capture modal; this keeps the
  // existing-tests-still-green when learners never supply a number.
  const normalizedPhone = phone
    ? phone.replace(/[\s\-()]/g, "") || null
    : null;

  // Defence-in-depth against URL tampering. The intake spec's
  // `ageBand.adultOnly()` invariant already rejects `under-18` before
  // ProjectionCommit fires (see `apps/admin/lib/intake/specs/enrollment.intent.ts`
  // line ~186), so this should never legitimately reach the endpoint.
  // If it does, refuse the join — the compliance trail must record
  // adult declaration only. See #1036.
  if (ageRange === "under-18") {
    return NextResponse.json(
      { ok: false, error: "Under-18 enrollment is not supported via this flow." },
      { status: 400 }
    );
  }

  // Don't overwrite session cookie for admins/operators testing the join flow
  const skipCookie = await hasHigherRoleSession(request);

  const cohort = await prisma.cohortGroup.findUnique({
    where: { joinToken: token },
    select: {
      id: true,
      isActive: true,
      joinTokenExp: true,
      domainId: true,
      institutionId: true,
      domain: { select: { id: true } },
    },
  });

  if (!cohort || !cohort.isActive) {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired join link" },
      { status: 404 }
    );
  }

  // Check expiry
  if (cohort.joinTokenExp && new Date(cohort.joinTokenExp) < new Date()) {
    return NextResponse.json(
      { ok: false, error: "This join link has expired" },
      { status: 410 }
    );
  }

  // Validate playbookId belongs to the cohort's domain (prevent cross-domain enrollment)
  if (playbookId) {
    const playbook = await prisma.playbook.findFirst({
      where: { id: playbookId, domainId: cohort.domainId },
      select: { id: true },
    });
    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found in this classroom" },
        { status: 400 }
      );
    }
  }

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  if (existingUser) {
    // User exists — check if they already have a caller in this cohort
    // Check if user already has a membership in this cohort (via join table or legacy FK)
    const existingMembership = await prisma.callerCohortMembership.findFirst({
      where: {
        cohortGroupId: cohort.id,
        caller: { userId: existingUser.id },
      },
      select: { callerId: true },
    });
    const existingCallerDirect = !existingMembership
      ? await prisma.caller.findFirst({
          where: { userId: existingUser.id, cohortGroupId: cohort.id },
          select: { id: true },
        })
      : null;

    const returningCallerId = existingMembership?.callerId ?? existingCallerDirect?.id;

    if (returningCallerId) {
      // Returning learner — sign them in and redirect to their journey
      const returningResponse = NextResponse.json({
        ok: true,
        alreadyEnrolled: true,
        message: "Welcome back! Picking up where you left off.",
        callerId: returningCallerId,
        redirect: `/x/sim/${returningCallerId}`,
      });

      try {
        await mintAndSetSessionCookie(returningResponse, existingUser, { skipCookie });
      } catch {
        return missingSecretResponse();
      }

      return returningResponse;
    }

    // Add existing user to this cohort
    const newCaller = await prisma.caller.create({
      data: {
        name: `${firstName.trim()} ${lastName.trim()}`,
        email: email.trim().toLowerCase(),
        role: "LEARNER",
        userId: existingUser.id,
        domainId: cohort.domainId,
        cohortGroupId: cohort.id, // legacy FK
        externalId: `join-${existingUser.id}-${cohort.id}`,
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      },
    });

    // Persist the declared age band as a CallerAttribute for the
    // compliance trail — #1036. The `intake.ageRange` key + GLOBAL
    // scope mirror existing person-level attributes; valueType STRING
    // because AGE_BAND_VALUES is an enum tuple of strings.
    if (ageRange) {
      await prisma.callerAttribute.upsert({
        where: { callerId_key_scope: { callerId: newCaller.id, key: "intake.ageRange", scope: "GLOBAL" } },
        create: {
          callerId: newCaller.id,
          key: "intake.ageRange",
          scope: "GLOBAL",
          valueType: "STRING",
          stringValue: ageRange,
          sourceSpecSlug: "EnrollmentIntake",
        },
        update: { stringValue: ageRange },
      });
    }

    // Create join table membership
    await prisma.callerCohortMembership.create({
      data: { callerId: newCaller.id, cohortGroupId: cohort.id },
    });

    // Enroll — single course if specified, otherwise all cohort playbooks
    if (cohort.domainId) {
      if (playbookId) {
        await enrollCaller(newCaller.id, playbookId, "join");
      } else {
        await enrollCallerInCohortPlaybooks(newCaller.id, cohort.id, cohort.domainId, "join");
      }
    }

    // Skip onboarding if requested
    if (skipOnboarding && cohort.domainId) {
      await applySkipOnboarding(newCaller.id, cohort.domainId);
    }

    // Issue first-call PIN (#1101). Best-effort — SMTP failure won't roll
    // back the Caller; the learner can request a resend on the sim page.
    await issueFirstCallPin({
      callerId: newCaller.id,
      email: email.trim().toLowerCase(),
      firstName: firstName.trim(),
    });

    const existingResponse = NextResponse.json({
      ok: true,
      message: "Joined classroom",
      callerId: newCaller.id,
      redirect: `/x/sim/${newCaller.id}`,
    });

    try {
      await mintAndSetSessionCookie(existingResponse, existingUser, { skipCookie });
    } catch {
      return missingSecretResponse();
    }

    return existingResponse;
  }

  // Create new user + caller in one transaction
  const result = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: email.trim().toLowerCase(),
        name: `${firstName.trim()} ${lastName.trim()}`,
        displayName: firstName.trim(),
        role: "STUDENT",
        emailVerified: new Date(),
        isActive: true,
        assignedDomainId: cohort.domainId,
        institutionId: cohort.institutionId,
      },
    });

    const newCaller = await tx.caller.create({
      data: {
        name: `${firstName.trim()} ${lastName.trim()}`,
        email: email.trim().toLowerCase(),
        role: "LEARNER",
        userId: newUser.id,
        domainId: cohort.domainId,
        cohortGroupId: cohort.id, // legacy FK
        externalId: `join-${newUser.id}`,
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      },
    });

    // Persist the declared age band as a CallerAttribute for the
    // compliance trail — #1036. Same pattern as the existing-user path
    // above; here we write inside the user+caller transaction.
    if (ageRange) {
      await tx.callerAttribute.upsert({
        where: { callerId_key_scope: { callerId: newCaller.id, key: "intake.ageRange", scope: "GLOBAL" } },
        create: {
          callerId: newCaller.id,
          key: "intake.ageRange",
          scope: "GLOBAL",
          valueType: "STRING",
          stringValue: ageRange,
          sourceSpecSlug: "EnrollmentIntake",
        },
        update: { stringValue: ageRange },
      });
    }

    // Create join table membership
    await tx.callerCohortMembership.create({
      data: { callerId: newCaller.id, cohortGroupId: cohort.id },
    });

    // Enroll — single course if specified, otherwise all cohort playbooks
    if (cohort.domainId) {
      if (playbookId) {
        await enrollCaller(newCaller.id, playbookId, "join", tx);
      } else {
        await enrollCallerInCohortPlaybooks(newCaller.id, cohort.id, cohort.domainId, "join", tx);
      }
    }

    return { newUser, newCallerId: newCaller.id };
  });

  // Skip onboarding after tx commits (applySkipOnboarding uses global prisma)
  if (skipOnboarding && cohort.domainId) {
    await applySkipOnboarding(result.newCallerId, cohort.domainId);
  }

  // Issue first-call PIN (#1101). Outside the transaction by design — SMTP
  // failure must not roll back the user+caller create. TL review note.
  await issueFirstCallPin({
    callerId: result.newCallerId,
    email: email.trim().toLowerCase(),
    firstName: firstName.trim(),
  });

  const response = NextResponse.json({
    ok: true,
    message: "Welcome! You've joined the classroom.",
    callerId: result.newCallerId,
    redirect: `/x/sim/${result.newCallerId}`,
  });

  try {
    await mintAndSetSessionCookie(response, result.newUser, { skipCookie });
  } catch {
    return missingSecretResponse();
  }

  return response;
}
