/**
 * @api POST /api/curricula/lo-review-queue/:classificationId/decide
 * @visibility internal
 * @scope curricula:write
 * @auth OPERATOR
 * @tags curriculum, content-review
 * @description Finalise a queued LO classification (#317). Two outcomes:
 *
 *   - action="approve": apply the classifier's proposal to the LO row
 *     (learnerVisible / performanceStatement / systemRole), set
 *     humanOverriddenAt, and mark the LoClassification row applied=true.
 *
 *   - action="reject": keep the LO row's current values; just stamp
 *     humanOverriddenAt so future classifier re-runs don't override the
 *     human's "I looked at this and the current state is correct" call.
 *     The LoClassification row stays applied=false (history preserves
 *     the rejected proposal for audit).
 *
 * @body action "approve" | "reject"
 * @returns { ok, lo: { id, learnerVisible, performanceStatement, systemRole, humanOverriddenAt } }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ classificationId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { classificationId } = await params;
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: "action must be 'approve' or 'reject'" },
        { status: 400 },
      );
    }

    const classification = await prisma.loClassification.findUnique({
      where: { id: classificationId },
      include: { lo: { select: { id: true, humanOverriddenAt: true } } },
    });

    if (!classification) {
      return NextResponse.json({ error: "Classification not found" }, { status: 404 });
    }

    if (classification.lo.humanOverriddenAt !== null) {
      // Already reviewed; idempotent — surface the current state.
      return NextResponse.json({
        ok: true,
        alreadyDecided: true,
        lo: { id: classification.lo.id },
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const now = new Date();

      if (action === "approve") {
        // Write the proposal onto the LO row + stamp human override.
        const lo = await tx.learningObjective.update({
          where: { id: classification.loId },
          data: {
            learnerVisible: classification.proposedLearnerVisible,
            performanceStatement: classification.proposedPerformanceStatement,
            systemRole: classification.proposedSystemRole,
            humanOverriddenAt: now,
          },
          select: {
            id: true,
            ref: true,
            learnerVisible: true,
            performanceStatement: true,
            systemRole: true,
            humanOverriddenAt: true,
          },
        });
        // Mark this run as applied for traceability.
        await tx.loClassification.update({
          where: { id: classificationId },
          data: { applied: true, appliedAt: now },
        });
        return lo;
      }

      // Reject path — LO row keeps its current values; just stamp the override.
      const lo = await tx.learningObjective.update({
        where: { id: classification.loId },
        data: { humanOverriddenAt: now },
        select: {
          id: true,
          ref: true,
          learnerVisible: true,
          performanceStatement: true,
          systemRole: true,
          humanOverriddenAt: true,
        },
      });
      // applied stays false; classification row preserves the rejected proposal.
      return lo;
    });

    return NextResponse.json({ ok: true, lo: updated });
  } catch (error: any) {
    console.error("[lo-review-queue/decide] POST error:", error);
    return NextResponse.json({ error: error?.message ?? "unknown error" }, { status: 500 });
  }
}
