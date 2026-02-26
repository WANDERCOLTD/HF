import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api POST /api/communities/[communityId]/invite
 * @visibility internal
 * @scope communities:write
 * @auth session
 * @tags communities, invites
 * @description Send email invites to join a community. Creates TESTER-role invites with
 *   LEARNER caller role and 30-day expiry. Deduplicates against existing pending invites.
 *   Requires the community to have a CohortGroup (created during community setup).
 * @param communityId string - Community domain ID
 * @body emails string[] - Array of email addresses to invite
 * @response 200 { ok: true, created: number, skipped: number }
 * @response 400 { ok: false, error: "..." }
 * @response 404 { ok: false, error: "Community not found" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { communityId } = await params;

    // Verify community + get its CohortGroup
    const community = await prisma.domain.findUnique({
      where: { id: communityId },
      select: {
        kind: true,
        cohortGroups: {
          where: { isActive: true },
          select: { id: true, domainId: true },
          take: 1,
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!community || community.kind !== "COMMUNITY") {
      return NextResponse.json(
        { ok: false, error: "Community not found" },
        { status: 404 }
      );
    }

    const cohort = community.cohortGroups[0];
    if (!cohort) {
      return NextResponse.json(
        { ok: false, error: "Community has no join group — it may have been created before join links were supported" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { emails } = body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json(
        { ok: false, error: "At least one email is required" },
        { status: 400 }
      );
    }

    // Validate and deduplicate emails
    const validEmails = [
      ...new Set(
        emails
          .map((e: string) => e.trim().toLowerCase())
          .filter((e: string) => e.includes("@") && e.length > 3)
      ),
    ];

    if (validEmails.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid email addresses provided" },
        { status: 400 }
      );
    }

    // Dedup against existing pending invites
    const existingInvites = await prisma.invite.findMany({
      where: { email: { in: validEmails }, usedAt: null },
      select: { email: true },
    });
    const existingEmails = new Set(existingInvites.map((i) => i.email));
    const newEmails = validEmails.filter(
      (e: string) => !existingEmails.has(e)
    );

    if (newEmails.length === 0) {
      return NextResponse.json({
        ok: true,
        created: 0,
        skipped: validEmails.length,
        message: "All email addresses already have pending invites",
      });
    }

    // Create invites with 30-day expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const invites = await prisma.invite.createMany({
      data: newEmails.map((email: string) => ({
        email,
        role: "TESTER" as const,
        callerRole: "LEARNER" as const,
        cohortGroupId: cohort.id,
        domainId: cohort.domainId,
        invitedById: authResult.session.user!.id,
        expiresAt,
      })),
      skipDuplicates: true,
    });

    return NextResponse.json({
      ok: true,
      created: invites.count,
      skipped: validEmails.length - newEmails.length,
    });
  } catch (error: any) {
    console.error("Error creating community invites:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to send invites" },
      { status: 500 }
    );
  }
}
