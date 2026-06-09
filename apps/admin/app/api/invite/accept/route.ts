import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateBody, inviteAcceptSchema } from "@/lib/validation";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";
import { enrollCaller, enrollCallerInCohortPlaybooks, resolveAndEnrollSingle } from "@/lib/enrollment";
import { autoComposeForCaller } from "@/lib/enrollment/auto-compose";
import { mintAndSetSessionCookie } from "@/lib/auth-session-cookie";

/**
 * #1420 — fire `autoComposeForCaller` for every ACTIVE enrollment the
 * caller has, one fire-and-forget Promise per playbook. Called POST-tx
 * to repair the `enrollCaller(..., tx)` suppression of auto-compose.
 *
 * Mirrors `fireBootstrapComposeForActiveEnrollments` in
 * `app/api/join/[token]/route.ts`. The two routes intentionally do not
 * share a helper today — they live in different route handlers with
 * different lookup costs, and inlining keeps the audit trail of where
 * post-tx compose is wired. If a third route needs the same pattern,
 * factor into `lib/enrollment/post-tx-compose.ts` at that time.
 */
async function fireBootstrapComposeForActiveEnrollments(callerId: string): Promise<void> {
  try {
    const enrollments = await prisma.callerPlaybook.findMany({
      where: { callerId, status: "ACTIVE" },
      select: { playbookId: true },
    });
    for (const { playbookId } of enrollments) {
      autoComposeForCaller(callerId, playbookId).catch((err) => {
        console.error(
          `[invite-accept] post-tx autoCompose failed for caller=${callerId.slice(0, 8)} ` +
            `playbook=${playbookId.slice(0, 8)}:`,
          err instanceof Error ? err.message : String(err),
        );
      });
    }
  } catch (err) {
    console.error(
      `[invite-accept] post-tx enrollment lookup failed for caller=${callerId.slice(0, 8)}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

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
    const result = await prisma.$transaction(async (tx) => {
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

      let newCallerId: string | null = null;

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
        newCallerId = newCaller.id;

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

      return { user: newUser, callerId: newCallerId };
    });
    const user = result.user;

    // #1420 — fire the bootstrap compose POST-tx for each ACTIVE
    // enrollment. The in-tx `enrollCaller(..., tx)` calls above trip the
    // `!tx` guard in `lib/enrollment/index.ts` and silently skip the
    // auto-compose; brand-new callers' Call 1 would otherwise hit the
    // `build-assistant-config.ts` hardcoded fallback. Fire-and-forget;
    // failures DO NOT propagate to the HTTP response.
    if (result.callerId) {
      await fireBootstrapComposeForActiveEnrollments(result.callerId);
    }

    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });

    try {
      await mintAndSetSessionCookie(response, user);
    } catch {
      console.error("[Invite Accept] No NEXTAUTH_SECRET configured");
      return NextResponse.json(
        { ok: false, error: "Server configuration error" },
        { status: 500 }
      );
    }

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
