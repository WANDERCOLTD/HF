import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encode } from "next-auth/jwt";
import { validateBody, inviteAcceptSchema } from "@/lib/validation";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";
import { enrollCaller, enrollCallerInCohortPlaybooks, resolveAndEnrollSingle } from "@/lib/enrollment";

/**
 * @api POST /api/invite/accept
 * @visibility public
 * @auth none
 * @tags invites
 * @description Accepts an invite: creates User account, marks invite used, sets session cookie for auto sign-in.
 * @body token string - Invite token (required)
 * @body firstName string - User's first name (required)
 * @body lastName string - User's last name (required)
 * @response 200 { ok: true, user: { id, email, name, role } }
 * @response 400 { ok: false, error: "..." }
 * @response 404 { ok: false, error: "Invite not found, expired, or already used" }
 */
export async function POST(request: NextRequest) {
  try {
    const rl = checkRateLimit(getClientIP(request), "invite-accept");
    if (!rl.ok) return rl.error;

    const body = await request.json();
    const v = validateBody(inviteAcceptSchema, body);
    if (!v.ok) return v.error;
    const { token, firstName, lastName } = v.data;

    // Find and validate invite
    const invite = await prisma.invite.findUnique({
      where: { token },
    });

    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      return NextResponse.json(
        { ok: false, error: "Invite not found, expired, or already used" },
        { status: 404 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: invite.email },
    });

    if (existingUser) {
      // Same error shape as "not found" to prevent email enumeration
      return NextResponse.json(
        { ok: false, error: "Invite not found, expired, or already used" },
        { status: 404 }
      );
    }

    // Create user, linked Caller (if callerRole set), and mark invite used
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: invite.email,
          name: `${firstName.trim()} ${lastName.trim()}`,
          displayName: firstName.trim(),
          role: invite.role,
          emailVerified: new Date(),
          isActive: true,
          ...(invite.domainId ? { assignedDomainId: invite.domainId } : {}),
        },
      });

      // Auto-create Caller if invite specifies a callerRole
      // (EDUCATOR invites create TEACHER callers, student invites create LEARNER callers)
      if (invite.callerRole) {
        const newCaller = await tx.caller.create({
          data: {
            name: `${firstName.trim()} ${lastName.trim()}`,
            email: invite.email,
            role: invite.callerRole,
            userId: newUser.id,
            domainId: invite.domainId,
            cohortGroupId: invite.cohortGroupId, // legacy FK
            externalId: `invite-${newUser.id}`,
          },
        });

        // Create join table membership if cohort specified
        if (invite.cohortGroupId) {
          await tx.callerCohortMembership.create({
            data: { callerId: newCaller.id, cohortGroupId: invite.cohortGroupId },
          });
        }

        // Auto-enroll: specific playbook > cohort playbooks > smart single resolve
        if (invite.playbookId) {
          await enrollCaller(newCaller.id, invite.playbookId, "invite", tx);
        } else if (invite.cohortGroupId && invite.domainId) {
          await enrollCallerInCohortPlaybooks(newCaller.id, invite.cohortGroupId, invite.domainId, "invite", tx);
        } else if (invite.domainId) {
          await resolveAndEnrollSingle(newCaller.id, invite.domainId, "invite", null, tx);
        }
      }

      await tx.invite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      });

      return newUser;
    });

    // Generate JWT session token matching auth.ts jwt callback shape
    const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
    if (!secret) {
      console.error("[Invite Accept] No NEXTAUTH_SECRET configured");
      return NextResponse.json(
        { ok: false, error: "Server configuration error" },
        { status: 500 }
      );
    }

    const jwtToken = await encode({
      token: {
        sub: user.id,
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      secret,
      salt: "authjs.session-token",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });

    // Set session cookie matching NextAuth cookie name
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
  } catch (error: unknown) {
    console.error("POST /api/invite/accept error:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to accept invite",
      },
      { status: 500 }
    );
  }
}
