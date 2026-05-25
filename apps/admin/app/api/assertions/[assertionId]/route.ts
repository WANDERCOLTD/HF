import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { bumpPlaybookComposeTimestamp } from "@/lib/compose/bump-timestamp";
import { resolvePlaybookIdsForContentSource } from "@/lib/curriculum/resolve-playbook-for-curriculum";

/**
 * @api PATCH /api/assertions/:assertionId
 * @visibility internal
 * @scope content-trust:write
 * @auth OPERATOR
 * @tags content-trust, curricula
 * @description Update editable fields on a ContentAssertion. Currently scoped
 *   to `learningObjectiveId` for the manual LO picker in AssertionDetailDrawer
 *   (issue #162). Writing a non-null `learningObjectiveId` also sets
 *   `linkConfidence = 1.0` (teacher-verified). Clearing it nulls both.
 * @pathParam assertionId string
 * @body { learningObjectiveId: string | null }
 * @response 200 { ok, assertion: { id, learningObjectiveId, learningOutcomeRef, linkConfidence } }
 */

const BodySchema = z.object({
  learningObjectiveId: z.string().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ assertionId: string }> },
) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { assertionId } = await params;
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { learningObjectiveId } = parsed.data;

    // Writing a non-null FK: teacher-verified → linkConfidence = 1.0, also
    // sync `learningOutcomeRef` to the target LO ref so Pass 1 can short-
    // circuit on the next reconcile run.
    if (learningObjectiveId) {
      const lo = await prisma.learningObjective.findUnique({
        where: { id: learningObjectiveId },
        select: { id: true, ref: true },
      });
      if (!lo) {
        return NextResponse.json(
          { ok: false, error: "LearningObjective not found" },
          { status: 404 },
        );
      }
      const updated = await prisma.contentAssertion.update({
        where: { id: assertionId },
        data: {
          learningObjectiveId: lo.id,
          learningOutcomeRef: lo.ref,
          linkConfidence: 1.0,
        },
        select: {
          id: true,
          sourceId: true,
          learningObjectiveId: true,
          learningOutcomeRef: true,
          linkConfidence: true,
        },
      });
      // #834 — assertion → LO link flows into compose via the curriculum
      // assertions loader. Bump every playbook that links this source.
      const playbookIds = await resolvePlaybookIdsForContentSource(updated.sourceId);
      for (const pbId of playbookIds) await bumpPlaybookComposeTimestamp(pbId);
      return NextResponse.json({ ok: true, assertion: updated });
    }

    // Clearing: null the FK, ref, and confidence together
    const updated = await prisma.contentAssertion.update({
      where: { id: assertionId },
      data: {
        learningObjectiveId: null,
        learningOutcomeRef: null,
        linkConfidence: null,
      },
      select: {
        id: true,
        sourceId: true,
        learningObjectiveId: true,
        learningOutcomeRef: true,
        linkConfidence: true,
      },
    });
    const playbookIds = await resolvePlaybookIdsForContentSource(updated.sourceId);
    for (const pbId of playbookIds) await bumpPlaybookComposeTimestamp(pbId);
    return NextResponse.json({ ok: true, assertion: updated });
  } catch (err: any) {
    console.error("[PATCH assertion] Error:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Internal error" },
      { status: 500 },
    );
  }
}
