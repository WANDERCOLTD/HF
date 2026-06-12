/* eslint-disable hf-security/no-unscoped-caller-id-route --
 * HF-M.2 rule audit: handler is EDUCATOR + ownership check-only at the auth gate; STUDENT cannot
 * reach. The studentAllowedToReadCaller guard would be a no-op here; the
 * disable + this comment is the documented trust chain. If the auth gate
 * ever loosens to admit STUDENT (e.g. requireAuth("VIEWER")), remove this
 * disable AND add the guard call.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireEducator,
  isEducatorAuthError,
  requireEducatorCohortOwnership,
} from "@/lib/educator-access";

/**
 * @api DELETE /api/educator/classrooms/[id]/members/[callerId]
 * @visibility internal
 * @scope educator:write
 * @auth bearer
 * @tags educator, classrooms, students
 * @description Remove a student from a classroom by unlinking them from the cohort. Does not delete the caller record. Requires educator ownership of the cohort.
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: "Student not found in this classroom" }
 * @response 403 { ok: false, error: "Not authorized" }
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; callerId: string }> }
) {
  const auth = await requireEducator();
  if (isEducatorAuthError(auth)) return auth.error;

  const { id, callerId } = await params;
  const ownership = await requireEducatorCohortOwnership(id, auth.callerId);
  if ("error" in ownership) return ownership.error;

  // Verify the caller is a member of this cohort (join table or legacy FK)
  const membership = await prisma.callerCohortMembership.findUnique({
    where: { callerId_cohortGroupId: { callerId, cohortGroupId: id } },
  });

  if (!membership) {
    // Fallback: check legacy FK
    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
      select: { cohortGroupId: true },
    });
    if (!caller || caller.cohortGroupId !== id) {
      return NextResponse.json(
        { ok: false, error: "Student not found in this classroom" },
        { status: 404 }
      );
    }
  }

  // Remove from join table
  await prisma.callerCohortMembership.deleteMany({
    where: { callerId, cohortGroupId: id },
  });

  // Legacy FK cleanup
  await prisma.caller.updateMany({
    where: { id: callerId, cohortGroupId: id },
    data: { cohortGroupId: null },
  });

  return NextResponse.json({ ok: true });
}
