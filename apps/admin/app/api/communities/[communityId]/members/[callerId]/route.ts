/* eslint-disable hf-security/no-unscoped-caller-id-route --
 * HF-M.2 rule audit: handler is OPERATOR-only at the auth gate; STUDENT cannot
 * reach. The studentAllowedToReadCaller guard would be a no-op here; the
 * disable + this comment is the documented trust chain. If the auth gate
 * ever loosens to admit STUDENT (e.g. requireAuth("VIEWER")), remove this
 * disable AND add the guard call.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api DELETE /api/communities/[communityId]/members/[callerId]
 * @visibility public
 * @scope communities:write
 * @auth session
 * @tags communities, members
 * @description Remove a caller from a community by clearing their domainId
 * @param communityId string - Community domain ID
 * @param callerId string - Caller ID to remove
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: "Community not found" | "Member not found" }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ communityId: string; callerId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { communityId, callerId } = await params;

    // Verify it's a community
    const community = await prisma.domain.findUnique({
      where: { id: communityId },
      select: { kind: true },
    });

    if (!community || community.kind !== "COMMUNITY") {
      return NextResponse.json(
        { ok: false, error: "Community not found" },
        { status: 404 }
      );
    }

    // Verify caller is a member
    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
      select: { domainId: true },
    });

    if (!caller || caller.domainId !== communityId) {
      return NextResponse.json(
        { ok: false, error: "Member not found in this community" },
        { status: 404 }
      );
    }

    // Remove from community by clearing domainId
    await prisma.caller.update({
      where: { id: callerId },
      data: { domainId: null },
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Error removing community member:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to remove member" },
      { status: 500 }
    );
  }
}
