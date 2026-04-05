import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encode } from "next-auth/jwt";
import { validateBody, joinPostSchema } from "@/lib/validation";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";
import { enrollCaller, enrollCallerInCohortPlaybooks } from "@/lib/enrollment";
import { applySkipOnboarding } from "@/lib/enrollment/skip-onboarding";

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
  const { firstName, lastName, email, playbookId, skipOnboarding } = v.data;

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
      const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
      if (!secret) {
        return NextResponse.json(
          { ok: false, error: "Server configuration error" },
          { status: 500 }
        );
      }

      const returningJwt = await encode({
        token: {
          sub: existingUser.id,
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
          role: existingUser.role,
        },
        secret,
        salt: "authjs.session-token",
        maxAge: 30 * 24 * 60 * 60,
      });

      const returningResponse = NextResponse.json({
        ok: true,
        alreadyEnrolled: true,
        message: "Welcome back! Picking up where you left off.",
        callerId: returningCallerId,
        redirect: `/x/sim/${returningCallerId}`,
      });

      const isProductionReturning = process.env.NODE_ENV === "production";
      const cookieNameReturning = isProductionReturning
        ? "__Secure-authjs.session-token"
        : "authjs.session-token";

      returningResponse.cookies.set(cookieNameReturning, returningJwt, {
        httpOnly: true,
        secure: isProductionReturning,
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
      });

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
      },
    });

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

    // Auto sign-in via JWT cookie (same as new-user path)
    const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: "Server configuration error" },
        { status: 500 }
      );
    }

    const existingJwt = await encode({
      token: {
        sub: existingUser.id,
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
        role: existingUser.role,
      },
      secret,
      salt: "authjs.session-token",
      maxAge: 30 * 24 * 60 * 60,
    });

    const existingResponse = NextResponse.json({
      ok: true,
      message: "Joined classroom",
      callerId: newCaller.id,
      redirect: `/x/sim/${newCaller.id}`,
    });

    const isProductionExisting = process.env.NODE_ENV === "production";
    const cookieNameExisting = isProductionExisting
      ? "__Secure-authjs.session-token"
      : "authjs.session-token";

    existingResponse.cookies.set(cookieNameExisting, existingJwt, {
      httpOnly: true,
      secure: isProductionExisting,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });

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
      },
    });

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

  // Auto sign-in via JWT cookie
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Server configuration error" },
      { status: 500 }
    );
  }

  const jwtToken = await encode({
    token: {
      sub: result.newUser.id,
      id: result.newUser.id,
      email: result.newUser.email,
      name: result.newUser.name,
      role: result.newUser.role,
    },
    secret,
    salt: "authjs.session-token",
    maxAge: 30 * 24 * 60 * 60,
  });

  const response = NextResponse.json({
    ok: true,
    message: "Welcome! You've joined the classroom.",
    callerId: result.newCallerId,
    redirect: `/x/sim/${result.newCallerId}`,
  });

  const isProduction = process.env.NODE_ENV === "production";
  const cookieName = isProduction
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

  response.cookies.set(cookieName, jwtToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });

  return response;
}
